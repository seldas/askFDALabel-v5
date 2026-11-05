"""
Rule-of-Two (DILI) assessment.

Places a drug on the dose/lipophilicity quadrant described in Chen 2013: an
oral drug taken at >= 100 mg/day whose ALogP is >= 3 carries significantly
elevated risk of drug-induced liver injury. Both conditions must hold -- hence
"rule of two".

The two axes come from very different places, and the difference matters:

* **ALogP** is computed here, from structure, by the same RDKit implementation
  that produced the `alogp` column on the reference rows. Never mix logP
  implementations across the two -- literature values and Crippen values differ
  by enough to move points across the ALogP >= 3 boundary.

* **Maximum daily dose** is not stored anywhere in this application. It exists
  only as prose in the label's Dosage & Administration section, so it is read
  out by the LLM and returned with the sentence it came from. It is the axis
  with a hard cliff at 100 mg/day, so a misread does not nudge a point, it
  flips its quadrant. The client shows the extraction and lets the user correct
  it; `dose_source` records which of the two produced the plotted number.

See backend/database/seed/README.md for the reference set's provenance. Its
doses are hand-curated and flagged `needs-sme-review`, which the payload
carries through to the UI rather than presenting the cloud as settled.
"""

import json
import logging
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from database import db, DiliRo2Reference, DrugLabel, ActiveIngredientMap

logger = logging.getLogger(__name__)

#: Chen 2013 thresholds. Exported in the payload so the client re-scores a
#: manually corrected dose against the same numbers instead of copying them.
DOSE_THRESHOLD_MG = 100.0
ALOGP_THRESHOLD = 3.0

#: Dosage & Administration. The dose is quoted from here and nowhere else, so
#: the user can check the extraction against a single named section.
LOINC_DOSAGE_AND_ADMINISTRATION = '34068-7'

_PUBCHEM_TIMEOUT = 8


# ---------------------------------------------------------------------------
# ALogP
# ---------------------------------------------------------------------------

def _rdkit_alogp():
    """(fn, method_label), or (None, None) when RDKit is unavailable.

    Mirrors db_11_import_dili_reference.py deliberately: the reference rows and
    the drug under assessment must be scored by one implementation, so if that
    importer's method label and this one ever diverge, the plot is wrong.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen
        import rdkit
        method = f'rdkit-crippen-{getattr(rdkit, "__version__", "unknown")}'

        def compute(smiles):
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return None
            return round(Crippen.MolLogP(mol), 3)

        return compute, method
    except ImportError:
        return None, None


# ---------------------------------------------------------------------------
# Structure resolution
#
# SMILES for a UNII lives in Oracle DRUGLABEL.UNII_CHEM_STRUCT, which is
# internal-FDA only. PubChem PUG REST is the portable path and is the same
# source the reference CSV was built from, so both sides of the plot resolve
# structures the same way.
#
# Cached per process: chemistry for a given UNII is immutable, unlike the
# feature gates in dashboard.services.feature_gates, where a module-level cache
# would strand admin edits in one worker.
# ---------------------------------------------------------------------------

_structure_cache = {}
_structure_lock = threading.Lock()


def _pubchem_json(url):
    try:
        with urllib.request.urlopen(url, timeout=_PUBCHEM_TIMEOUT) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as exc:
        logger.info('PubChem lookup failed for %s: %s', url, exc)
        return None


#: PubChem renamed its SMILES properties: what was `CanonicalSMILES` is now
#: `ConnectivitySMILES`, and `IsomericSMILES` is now `SMILES`. Requesting an old
#: name still succeeds -- the value simply comes back under the *new* key -- so
#: reading only the old key silently yielded None for every drug. Ask for both
#: spellings and accept whichever the service returns.
_PUBCHEM_PROPS = 'SMILES,ConnectivitySMILES,XLogP,MolecularWeight,InChIKey'
_SMILES_KEYS = ('SMILES', 'ConnectivitySMILES', 'IsomericSMILES', 'CanonicalSMILES')

#: Salt formers stripped from a substance name as a last resort, when PubChem
#: has no record under the full name. Parent-CID resolution handles the usual
#: case; this only covers names PubChem cannot match at all.
_SALT_SUFFIXES = (
    'hydrochloride', 'dihydrochloride', 'hydrobromide', 'hydrate', 'sulfate',
    'sulphate', 'bisulfate', 'mesylate', 'besylate', 'tosylate', 'maleate',
    'fumarate', 'tartrate', 'bitartrate', 'citrate', 'acetate', 'phosphate',
    'succinate', 'malate', 'lactate', 'gluconate', 'oxalate', 'nitrate',
    'bromide', 'chloride', 'iodide', 'sodium', 'potassium', 'calcium',
    'magnesium', 'lithium', 'meglumine', 'pamoate', 'palmitate', 'stearate',
)


def _smiles_from(row):
    """The SMILES under whichever key this PubChem build uses."""
    for key in _SMILES_KEYS:
        value = row.get(key)
        if value:
            return value
    return None


def _strip_salt(name):
    """'ABACAVIR SULFATE' -> 'ABACAVIR'. None when nothing was stripped."""
    if not name:
        return None
    words = name.strip().split()
    if len(words) < 2:
        return None
    if words[-1].lower().strip(',') in _SALT_SUFFIXES:
        return ' '.join(words[:-1])
    return None


#: Two-letter element symbols that must be matched before their first letter
#: is mistaken for a one-letter element.
_TWO_LETTER_ELEMENTS = (
    'Cl', 'Br', 'Si', 'Se', 'As', 'Al', 'Zn', 'Mg', 'Ca', 'Na', 'Li', 'Fe',
    'Sn', 'Te', 'Ge', 'Sb', 'Bi', 'Cu', 'Mn', 'Cr', 'Co', 'Ni', 'Pt', 'Au',
)
_ORGANIC_SUBSET = set('BCNOPSFI')
_AROMATIC_SUBSET = set('bcnops')


def _heavy_atom_count(smiles):
    """
    Approximate heavy-atom count for a SMILES fragment.

    Used to pick the drug out of a salt. It must not be a character count:
    tartaric acid written with stereodescriptors
    ("[C@@H]([C@H](C(=O)O)O)(C(=O)O)O", 10 heavy atoms) is a *longer string*
    than metoprolol ("CC(C)NCC(COC1=CC=C(C=C1)CCOC)O", 19), so choosing by
    length hands back the counter-ion.
    """
    if not smiles:
        return 0
    bracketed = re.findall(r'\[[^\]]*\]', smiles)
    count = len(bracketed)
    rest = re.sub(r'\[[^\]]*\]', '', smiles)
    i = 0
    while i < len(rest):
        if rest[i:i + 2] in _TWO_LETTER_ELEMENTS:
            count += 1
            i += 2
            continue
        if rest[i] in _ORGANIC_SUBSET or rest[i] in _AROMATIC_SUBSET:
            count += 1
        i += 1
    return count


def _fragment_size(smiles):
    """Heavy atoms in a fragment, via RDKit when it is installed."""
    try:
        from rdkit import Chem
        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            return mol.GetNumHeavyAtoms()
    except ImportError:
        pass
    return _heavy_atom_count(smiles)


def _largest_fragment(smiles):
    """
    The drug component of a multi-component SMILES, by heavy-atom count.

    A last-resort guard: parent-CID resolution and a desalted name lookup both
    run first. If something still arrives as a mixture, computing Crippen logP
    across it would fold in the counter-ion and count the active moiety twice,
    so the largest fragment is taken and the caller reports that it happened.
    """
    if not smiles or '.' not in smiles:
        return smiles, False
    parts = [p for p in smiles.split('.') if p]
    if not parts:
        return smiles, False
    return max(parts, key=_fragment_size), True


def _pubchem_properties(domain, identifier):
    """Structure + XLogP for one PubChem identifier, or None."""
    url = (
        'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/'
        f'{domain}/{urllib.parse.quote(str(identifier))}/property/{_PUBCHEM_PROPS}/JSON'
    )
    data = _pubchem_json(url)
    try:
        row = data['PropertyTable']['Properties'][0]
    except (TypeError, KeyError, IndexError):
        return None
    smiles = _smiles_from(row)
    if not smiles:
        logger.info('PubChem returned no SMILES for %s/%s; keys were %s',
                    domain, identifier, sorted(row.keys()))
        return None
    return {
        'smiles': smiles,
        'pubchem_cid': str(row.get('CID')) if row.get('CID') is not None else None,
        'pubchem_xlogp3': row.get('XLogP'),
        'mol_weight': row.get('MolecularWeight'),
        'inchikey': row.get('InChIKey'),
    }


def _pubchem_parent_cid(cid):
    """The parent (free base) CID for a salt, or None."""
    if not cid:
        return None
    url = (
        'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/'
        f'{urllib.parse.quote(str(cid))}/cids/JSON?cids_type=parent'
    )
    data = _pubchem_json(url)
    try:
        parent = data['IdentifierList']['CID'][0]
    except (TypeError, KeyError, IndexError):
        return None
    return str(parent) if parent is not None else None


def resolve_structure(substance_name, unii=None):
    """
    Resolve a substance to the structure its logP should be computed on.

    SPL names the salt -- "ABACAVIR SULFATE" -- and PubChem will return the
    salt: two abacavir molecules plus sulfuric acid in one SMILES. Crippen
    logP across that is meaningless. The reference rows were built on parent
    (free-base) structures, so the drug under assessment is resolved the same
    way, via PubChem's parent-CID relationship, or the plot compares two
    different things.

    Lookup order: UNII, then the full substance name, then the name with a
    trailing salt former removed.
    """
    key = (unii or '', (substance_name or '').lower())
    with _structure_lock:
        if key in _structure_cache:
            return _structure_cache[key]

    attempts = []
    if unii:
        attempts.append(('pubchem-unii', 'xref/RegistryID', unii))
    if substance_name:
        attempts.append(('pubchem-name', 'name', substance_name))
        stripped = _strip_salt(substance_name)
        if stripped:
            attempts.append(('pubchem-name-desalted', 'name', stripped))

    resolved = None
    for source, domain, identifier in attempts:
        found = _pubchem_properties(domain, identifier)
        if found:
            found['smiles_source'] = source
            resolved = found
            break

    if resolved is not None:
        resolved['parent_resolved'] = False
        resolved['fragment_taken'] = False

        # A '.' means more than one component, i.e. a salt or co-crystal. Only
        # then is the extra round trip for the parent worth making.
        if '.' in (resolved['smiles'] or ''):
            parent_cid = _pubchem_parent_cid(resolved.get('pubchem_cid'))
            if parent_cid and parent_cid != resolved.get('pubchem_cid'):
                parent = _pubchem_properties('cid', parent_cid)
                if parent:
                    parent.update({
                        'smiles_source': resolved['smiles_source'],
                        'parent_resolved': True,
                        'fragment_taken': False,
                        'salt_cid': resolved.get('pubchem_cid'),
                    })
                    resolved = parent

        # PubChem has no parent for some salts (metoprolol tartrate among
        # them), but usually does hold the free base under the desalted name.
        # Far better than dissecting the mixture ourselves.
        if '.' in (resolved['smiles'] or '') and substance_name:
            stripped = _strip_salt(substance_name)
            if stripped:
                base = _pubchem_properties('name', stripped)
                if base and '.' not in (base['smiles'] or ''):
                    base.update({
                        'smiles_source': resolved['smiles_source'] + '+desalted-name',
                        'parent_resolved': True,
                        'fragment_taken': False,
                        'salt_cid': resolved.get('pubchem_cid'),
                    })
                    resolved = base

        if '.' in (resolved['smiles'] or ''):
            fragment, taken = _largest_fragment(resolved['smiles'])
            if taken:
                resolved['smiles'] = fragment
                resolved['fragment_taken'] = True
                # The salt record's XLogP describes the mixture, not this
                # fragment, so it must not be used as a logP fallback.
                resolved['pubchem_xlogp3'] = None

    with _structure_lock:
        _structure_cache[key] = resolved
    return resolved


# ---------------------------------------------------------------------------
# Dose extraction
# ---------------------------------------------------------------------------

DOSE_EXTRACTION_PROMPT = """You read FDA drug labeling and report the maximum \
recommended daily dose of the single active ingredient named by the user.

Return ONLY a JSON object, no prose and no code fence, with these keys:

  "max_daily_dose_mg": number or null
      The maximum recommended dose for an adult in ONE DAY, in milligrams of
      the active moiety. Convert units (g, mcg) to mg. If the label gives a
      range, use the top of the range. If the maximum is expressed per kg,
      compute it for a 60 kg adult and say so in dose_note.
  "dose_basis": one of "label-max" | "maintenance" | "typical-max" | "weight-based"
      "label-max"     an explicit maximum stated on the label
      "maintenance"   no stated maximum; the usual maintenance dose
      "typical-max"   no stated maximum; a customary clinical ceiling
      "weight-based"  derived from a mg/kg dose at 60 kg
  "dosing_interval": one of "daily" | "weekly" | "monthly" | "cyclic" | "single" | "other"
      How often the drug is taken. Report what the label says, not per-dose
      frequency within a day: a drug taken three times a day is "daily".
  "quote": string
      The single sentence from the text that most directly supports the number.
      Copy it verbatim. Do not paraphrase.
  "dose_note": string
      One short line on any assumption you made. Empty string if none.
  "confidence": "high" | "medium" | "low"
      "high" only when the label states a maximum daily dose outright.

If the text does not support a daily dose in milligrams, return
max_daily_dose_mg as null and explain in dose_note. Do not guess.
"""


def _coerce_float(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = re.sub(r'[^0-9.\-]', '', value)
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _parse_llm_json(raw):
    """LLM output to dict. Tolerates a code fence or surrounding prose."""
    if not raw:
        return None
    text = raw.strip()
    fenced = re.search(r'```(?:json)?\s*(.+?)```', text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    else:
        start, end = text.find('{'), text.rfind('}')
        if start != -1 and end > start:
            text = text[start:end + 1]
    try:
        parsed = json.loads(text)
    except ValueError:
        logger.warning('Rule-of-Two dose extraction returned unparseable JSON: %.300s', raw)
        return None
    return parsed if isinstance(parsed, dict) else None


def extract_dose(user, substance_name, dosage_text):
    """
    Read the maximum daily dose out of Dosage & Administration.

    Returns a dict that always carries `quote`, so the number is never shown
    without the sentence it came from.
    """
    from dashboard.services.ai_handler import call_llm

    blank = {
        'max_daily_dose_mg': None,
        'dose_basis': None,
        'dosing_interval': None,
        'quote': '',
        'dose_note': '',
        'confidence': None,
    }

    if not dosage_text:
        blank['dose_note'] = 'The label has no Dosage & Administration section to read.'
        return blank

    # Long enough for the dosing text of even a complex label, short enough to
    # stay well inside every configured provider's context window.
    excerpt = dosage_text[:24000]
    user_message = (
        f'Active ingredient: {substance_name or "unknown"}\n\n'
        f'Dosage & Administration section:\n"""\n{excerpt}\n"""'
    )

    try:
        raw = call_llm(user, DOSE_EXTRACTION_PROMPT, user_message, temperature=0.0)
    except Exception as exc:
        logger.error('Rule-of-Two dose extraction failed: %s', exc)
        blank['dose_note'] = f'Automatic extraction failed: {exc}'
        return blank

    parsed = _parse_llm_json(raw)
    if parsed is None:
        blank['dose_note'] = 'Automatic extraction returned an unreadable response.'
        return blank

    dose = _coerce_float(parsed.get('max_daily_dose_mg'))
    return {
        'max_daily_dose_mg': dose,
        'dose_basis': parsed.get('dose_basis') or None,
        'dosing_interval': parsed.get('dosing_interval') or None,
        'quote': (parsed.get('quote') or '').strip(),
        'dose_note': (parsed.get('dose_note') or '').strip(),
        'confidence': parsed.get('confidence') or None,
    }


# ---------------------------------------------------------------------------
# Reference set
# ---------------------------------------------------------------------------

def reference_points():
    """
    The plotted background cloud, and an honest account of it.

    The Chen 2013 set: 164 oral drugs, 116 Most-DILI-concern and 48
    No-DILI-concern. The paper omitted Less-DILI-concern drugs deliberately, so
    the cloud is a clean two-class contrast rather than a severity gradient.

    `alogp` is null for every row when the importer ran without RDKit; the
    fallback is then the paper's own published logP, and the caller must say
    which it plotted.
    """
    rows = DiliRo2Reference.query.order_by(DiliRo2Reference.drug_name).all()

    points = []
    recomputed = 0
    for row in rows:
        alogp, method = row.alogp, row.alogp_method
        if alogp is None and row.paper_logp is not None:
            alogp, method = row.paper_logp, 'chen-2013-published'
        if alogp is None or row.max_daily_dose_mg is None:
            continue
        if row.alogp is not None:
            recomputed += 1
        points.append({
            'drug_name': row.drug_name,
            'dili_concern': row.dili_concern,
            'dili_severity_class': row.dili_severity_class,
            'max_daily_dose_mg': row.max_daily_dose_mg,
            'alogp': alogp,
            'alogp_method': method,
            'paper_logp': row.paper_logp,
            'paper_ro2_test': row.paper_ro2_test,
            'dose_basis': row.dose_basis,
            'dose_note': row.dose_note,
            'dose_review_status': row.dose_review_status,
        })

    concerns = {}
    for row in rows:
        concerns[row.dili_concern] = concerns.get(row.dili_concern, 0) + 1

    return points, {
        'total_rows': len(rows),
        'plotted': len(points),
        'class_counts': concerns,
        #: How many points carry a recomputed ALogP rather than the published
        #: value. Anything short of `plotted` means the axes are mixed.
        'alogp_recomputed': recomputed,
        'source': (
            'Chen 2013 Supporting Table 1 — the 164 oral drugs the rule was '
            'derived on. Daily dose and logP are the published values.'
        ),
        'citation': (
            'Chen M, Borlak J, Tong W. High lipophilicity and high daily dose of oral '
            'medications are associated with significant risk for drug-induced liver '
            'injury. Hepatology. 2013;58(1):388-396. PMID 23258593.'
        ),
    }


# ---------------------------------------------------------------------------
# Assessment
# ---------------------------------------------------------------------------

def _label_row(set_id):
    return (
        DrugLabel.query
        .filter(DrugLabel.set_id == set_id)
        .order_by(DrugLabel.revised_date.desc())
        .first()
    )


def _active_ingredients(spl_id):
    if not spl_id:
        return []
    rows = (
        ActiveIngredientMap.query
        .filter(ActiveIngredientMap.spl_id == spl_id)
        .filter(ActiveIngredientMap.is_active == 1)
        .all()
    )
    seen, out = set(), []
    for row in rows:
        name = (row.substance_name or '').strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append({'substance_name': name, 'unii': (row.unii or '').strip() or None})
    return out


def score(max_daily_dose_mg, alogp):
    """
    Apply the rule. Both conditions, or it does not fire.

    Kept here rather than inline so the endpoint and any future caller cannot
    drift on the boundary; the client re-scores manual dose edits against the
    thresholds this module exports.
    """
    if max_daily_dose_mg is None or alogp is None:
        return {'high_dose': None, 'lipophilic': None, 'rule_of_two': None, 'quadrant': None}
    high_dose = max_daily_dose_mg >= DOSE_THRESHOLD_MG
    lipophilic = alogp >= ALOGP_THRESHOLD
    return {
        'high_dose': high_dose,
        'lipophilic': lipophilic,
        'rule_of_two': high_dose and lipophilic,
        'quadrant': (
            'high-dose-lipophilic' if high_dose and lipophilic else
            'high-dose-hydrophilic' if high_dose else
            'low-dose-lipophilic' if lipophilic else
            'low-dose-hydrophilic'
        ),
    }


def _drug_context(set_id):
    """Label row, active ingredients, and the reasons metadata alone disqualifies."""
    label = _label_row(set_id)
    if label is None:
        return None, [], ['No label found for this set id.'], []

    ingredients = _active_ingredients(label.spl_id)
    reasons, warnings = [], []

    routes = (label.routes or '').lower()
    if routes and 'oral' not in routes:
        reasons.append(
            "The Rule of Two is derived from oral medications; this label's route is "
            f"{label.routes}."
        )
    if not ingredients:
        reasons.append('No active ingredient is recorded for this label.')
    elif len(ingredients) > 1:
        # Scored on the first ingredient, but the rule was derived on single
        # entities -- the user needs to know which moiety the point represents.
        warnings.append(
            'This is a combination product. The point shown is for '
            f"{ingredients[0]['substance_name']} only; the rule was derived on "
            'single-ingredient oral drugs.'
        )
    return label, ingredients, reasons, warnings


def structure_stage(set_id):
    """
    The fast half: identity, structure and ALogP.

    Split from the dose so the client can paint lipophilicity while the LLM is
    still reading the label -- a PubChem round trip is seconds, the extraction
    is tens of seconds, and holding the first behind the second made the whole
    page look dead.
    """
    label, ingredients, reasons, warnings = _drug_context(set_id)
    if label is None:
        return {'stage': 'structure', 'reasons': reasons, 'warnings': warnings}

    primary = ingredients[0] if ingredients else None
    structure = resolve_structure(primary['substance_name'], primary['unii']) if primary else None

    alogp = alogp_method = None
    if structure:
        compute, method = _rdkit_alogp()
        if compute:
            alogp = compute(structure['smiles'])
            alogp_method = method
        if alogp is None and structure.get('pubchem_xlogp3') is not None:
            alogp = float(structure['pubchem_xlogp3'])
            alogp_method = 'pubchem-xlogp3'
            warnings.append(
                'ALogP fell back to PubChem XLogP3 because RDKit is unavailable. '
                'Without RDKit the reference points fall back to the logP published '
                'in Chen 2013, so this drug and the background cloud sit on two '
                'different logP scales and near-boundary points are not reliable.'
            )
    elif primary:
        reasons.append(
            f"No chemical structure could be resolved for {primary['substance_name']}."
        )

    return {
        'stage': 'structure',
        'set_id': set_id,
        'spl_id': label.spl_id,
        'brand_name': label.product_names,
        'generic_name': label.generic_names,
        'route': label.routes,
        'dosage_forms': label.dosage_forms,
        'ingredients': ingredients,
        'substance_name': primary['substance_name'] if primary else None,
        'unii': primary['unii'] if primary else None,
        'smiles': structure['smiles'] if structure else None,
        'smiles_source': structure.get('smiles_source') if structure else None,
        'pubchem_cid': structure.get('pubchem_cid') if structure else None,
        # SPL names the salt; logP must be computed on the free base, as the
        # reference rows were. Reported so the user can see which structure
        # was actually scored.
        'parent_resolved': bool(structure.get('parent_resolved')) if structure else False,
        'salt_cid': structure.get('salt_cid') if structure else None,
        'fragment_taken': bool(structure.get('fragment_taken')) if structure else False,
        'alogp': alogp,
        'alogp_method': alogp_method,
        'reasons': reasons,
        'warnings': warnings,
    }


def dose_stage(user, set_id):
    """The slow half: read the maximum daily dose out of the label with the LLM."""
    label, ingredients, _, _ = _drug_context(set_id)
    primary = ingredients[0] if ingredients else None
    if label is None or primary is None:
        return {
            'stage': 'dose', 'max_daily_dose_mg': None, 'dose_basis': None,
            'dosing_interval': None, 'dose_quote': '', 'dose_note': '',
            'dose_confidence': None, 'dose_source': None,
            'dosage_section_present': False,
            'reasons': ['No active ingredient to read a dose for.'],
        }

    from dashboard.services.fda_client import get_label_xml
    from dashboard.services.xml_handler import extract_sections_by_loinc

    dosage_text = ''
    xml = get_label_xml(set_id, spl_id=label.spl_id)
    if xml:
        section = extract_sections_by_loinc(xml).get(LOINC_DOSAGE_AND_ADMINISTRATION)
        dosage_text = (section or {}).get('content', '')

    info = extract_dose(user, primary['substance_name'], dosage_text)

    reasons = []
    interval = (info.get('dosing_interval') or '').lower()
    if interval and interval not in ('daily', 'other'):
        # Methotrexate is the canonical case: dosed weekly, so "maximum daily
        # dose" is not a meaningful quantity and the seed set omits it.
        reasons.append(
            f'This drug is dosed {interval}, so a maximum *daily* dose is not a '
            'meaningful quantity for it.'
        )
    if info.get('max_daily_dose_mg') is None:
        reasons.append('No maximum daily dose could be read from the label.')

    return {
        'stage': 'dose',
        'max_daily_dose_mg': info['max_daily_dose_mg'],
        'dose_basis': info['dose_basis'],
        'dosing_interval': info['dosing_interval'],
        'dose_quote': info['quote'],
        'dose_note': info['dose_note'],
        'dose_confidence': info['confidence'],
        'dose_source': 'ai-extracted' if info['max_daily_dose_mg'] is not None else None,
        'dosage_section_present': bool(dosage_text),
        'reasons': reasons,
    }


def assess(user, set_id):
    """
    Everything in one response, for a caller that wants a single round trip.

    The page does not use this -- it runs the stages in parallel so the chart
    paints before the LLM returns -- but it composes the same stages, so the
    two cannot drift apart.
    """
    points, provenance = reference_points()
    payload = {
        'set_id': set_id,
        'thresholds': {
            'max_daily_dose_mg': DOSE_THRESHOLD_MG,
            'alogp': ALOGP_THRESHOLD,
        },
        'reference': points,
        'reference_provenance': provenance,
        'drug': None,
        'qualification': {'qualified': False, 'reasons': []},
        'warnings': [],
    }

    structure = structure_stage(set_id)
    if 'set_id' not in structure:
        payload['qualification'] = {'qualified': False, 'reasons': structure['reasons']}
        payload['warnings'] = structure['warnings']
        return payload

    dose = dose_stage(user, set_id)
    reasons = structure['reasons'] + dose['reasons']

    drug = {k: v for k, v in structure.items() if k not in ('stage', 'reasons', 'warnings')}
    drug.update({k: v for k, v in dose.items() if k not in ('stage', 'reasons')})
    drug.update(score(dose['max_daily_dose_mg'], structure['alogp']))

    payload['drug'] = drug
    payload['warnings'] = structure['warnings']
    payload['qualification'] = {'qualified': not reasons, 'reasons': reasons}
    return payload
