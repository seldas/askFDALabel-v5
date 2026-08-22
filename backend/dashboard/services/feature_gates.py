"""
Runtime-configurable access rules for gated features.

Every feature that used to be gated by a hardcoded role check is described here
and resolved against the `feature_gate` table, so an admin can move a feature
between roles from the management panel instead of editing code.

Two halves, deliberately split:

* :data:`FEATURE_CATALOG` -- the code half. Name, blurb, category, where the
  rule is enforced, and the defaults that reproduce the original hardcoded
  behaviour. Adding a feature is a catalog entry, never a migration.
* ``FeatureGate`` rows -- the data half. Only ``min_role`` and ``allow_guest``,
  the parts an admin can change.

**No cross-request caching.** The whole point of the panel is that a change
takes effect without a restart, and this application runs at least two
processes (web and celery) plus a reloader. A module-level cache -- the pattern
`_check_is_internal` and `labelquery._capability_cache` use -- would strand
every process except the one that handled the write. The table holds one short
row per feature, so it is read per request and memoised only for the lifetime
of that request via `flask.g`.
"""

from flask import g, has_request_context

from database import db, FeatureGate, ROLES, ROLE_USER, ROLE_DEVELOPER, ROLE_ADMIN

#: Rank for comparing roles. A user satisfies a gate when their rank is at
#: least the gate's.
_ROLE_RANK = {ROLE_USER: 0, ROLE_DEVELOPER: 1, ROLE_ADMIN: 2}


class FeatureSpec:
    """One gated feature, as described in code."""

    def __init__(self, key, name, blurb, category, enforced_at,
                 default_min_role=ROLE_USER, default_allow_guest=False,
                 guest_relevant=True):
        self.key = key
        self.name = name
        self.blurb = blurb
        self.category = category
        #: Human-readable note about where the rule bites. Shown to the admin so
        #: the consequence of a change is not a guess.
        self.enforced_at = enforced_at
        self.default_min_role = default_min_role
        self.default_allow_guest = default_allow_guest
        #: False for features where the guest toggle is meaningless because the
        #: role requirement already excludes the guest account.
        self.guest_relevant = guest_relevant

    def to_dict(self):
        return {
            'key': self.key,
            'name': self.name,
            'blurb': self.blurb,
            'category': self.category,
            'enforced_at': self.enforced_at,
            'default_min_role': self.default_min_role,
            'default_allow_guest': self.default_allow_guest,
            'guest_relevant': self.guest_relevant,
        }


#: Every gated feature. Defaults reproduce the behaviour these gates had while
#: they were hardcoded, so seeding an existing deployment changes nothing.
FEATURE_CATALOG = [
    FeatureSpec(
        key='labelchat',
        name='LabelChat',
        blurb='AI chat that locates labeling records by drug name or identifier.',
        category='Modules',
        enforced_at='/api/search/* and the /search page',
        default_min_role=ROLE_DEVELOPER,
        guest_relevant=False,
    ),
    FeatureSpec(
        key='localquery',
        name='Local Database Search',
        blurb='Structured query over local SPL and drug records, with Excel export.',
        category='Modules',
        enforced_at='/api/localquery/* and the /localquery page',
        default_min_role=ROLE_DEVELOPER,
        guest_relevant=False,
    ),
    FeatureSpec(
        key='webtest',
        name='Web-test Tool',
        blurb='Automated regression testing of FDALabel web endpoints.',
        category='Modules',
        enforced_at='/api/webtest/* and the /webtest page',
        default_min_role=ROLE_DEVELOPER,
        guest_relevant=False,
    ),
    FeatureSpec(
        key='db_selection',
        name='Database Selection',
        blurb='Choose which labeling database a query runs against. '
              'Accounts without it are pinned to the CDER-CBER scope.',
        category='Query',
        enforced_at='the switch on the home page and every /api/labelquery route',
        default_min_role=ROLE_DEVELOPER,
        guest_relevant=False,
    ),
    FeatureSpec(
        key='query_history',
        name='Search & Query History',
        blurb='Recording and browsing past searches.',
        category='Account',
        enforced_at='/api/dashboard/query_history* and the history page',
        default_min_role=ROLE_USER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='preferences',
        name='Settings & Preferences',
        blurb='Saved AI provider and per-account credentials.',
        category='Account',
        enforced_at='/api/dashboard/preferences and the management page',
        default_min_role=ROLE_USER,
        default_allow_guest=False,
    ),

    # --- Product Toolbox Tools ---
    FeatureSpec(
        key='tool_dili',
        name='DILI Agent',
        blurb='Drug-Induced Liver Injury risk assessment & signal detection in product toolbox.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /drugtox?agent=dili',
        default_min_role=ROLE_USER,
        default_allow_guest=True,
    ),
    FeatureSpec(
        key='tool_dict',
        name='DICT Agent',
        blurb='Drug-Induced Cardiotoxicity risk assessment & signal detection in product toolbox.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /drugtox?agent=dict',
        default_min_role=ROLE_USER,
        default_allow_guest=True,
    ),
    FeatureSpec(
        key='tool_labelcomp',
        name='Compare',
        blurb='Side-by-side section diff comparison across multiple drug labels.',
        category='Product Toolbox',
        enforced_at='Product Toolbox, Navigation and /labelcomp',
        default_min_role=ROLE_USER,
        default_allow_guest=True,
    ),
    FeatureSpec(
        key='tool_ro2',
        name='Rule of Two',
        blurb='DILI Rule-of-Two daily dose vs. lipophilicity quadrant analysis.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/label/[setId]/ro2',
        default_min_role=ROLE_USER,
        default_allow_guest=True,
    ),
    FeatureSpec(
        key='tool_diri',
        name='DIRI Agent',
        blurb='Drug-Induced Renal Injury risk assessment & signal detection.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /drugtox?agent=diri',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_pgx',
        name='PGx Agent',
        blurb='Pharmacogenomic biomarker associations & genetic variant guidance.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /drugtox?agent=pgx',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_faers',
        name='FAERS Profile',
        blurb='Adverse event reports and MedDRA term profile for this product.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/label/[setId]/faers',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_examine',
        name='Examine',
        blurb='Run clinical prompt templates against this label.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/label/[setId]/examine',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_deepdive',
        name='Deep Dive',
        blurb='Compare this label against its pharmacologic class peers.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/label/[setId]/deepdive',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_history_set_id',
        name='Archived Version Track',
        blurb='Track historical versions of this label in the local label database.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/history/[set_id]',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
    FeatureSpec(
        key='tool_history_application',
        name='FDA Application Profile',
        blurb='Track versions associated with the FDA application number for this label.',
        category='Product Toolbox',
        enforced_at='Product Toolbox and /dashboard/history_by_appr_num/[appr_num]',
        default_min_role=ROLE_DEVELOPER,
        default_allow_guest=False,
    ),
]

FEATURE_KEYS = tuple(spec.key for spec in FEATURE_CATALOG)
_CATALOG_BY_KEY = {spec.key: spec for spec in FEATURE_CATALOG}


def get_spec(key):
    return _CATALOG_BY_KEY.get(key)


def seed_feature_gates():
    """
    Ensures a row exists for every catalog entry. Idempotent.

    Only inserts. An existing row is left exactly as the admin set it, so a
    restart never reverts a change.
    """
    try:
        existing = {row.key for row in FeatureGate.query.all()}
        added = 0
        for spec in FEATURE_CATALOG:
            if spec.key in existing:
                continue
            db.session.add(FeatureGate(
                key=spec.key,
                min_role=spec.default_min_role,
                allow_guest=spec.default_allow_guest,
            ))
            added += 1
        if added:
            db.session.commit()
            print(f"[INFO] Seeded {added} feature gate(s).")
    except Exception as e:
        print(f"[WARN] Could not seed feature gates: {e}")
        db.session.rollback()


def _load_gates():
    """
    Current gate values, keyed by feature.

    Memoised on `flask.g` so one request does not re-query per check, and not
    beyond it so the next request in any process sees an admin's change.
    """
    if has_request_context() and hasattr(g, '_feature_gates'):
        return g._feature_gates

    gates = {}
    try:
        for row in FeatureGate.query.all():
            gates[row.key] = {
                'min_role': row.min_role,
                'allow_guest': bool(row.allow_guest),
            }
    except Exception as e:
        # A missing table or a database blip must not open a gate. Falling back
        # to catalog defaults keeps the original hardcoded behaviour.
        print(f"[WARN] Could not read feature gates ({e}); using defaults.")
        gates = {}

    for spec in FEATURE_CATALOG:
        gates.setdefault(spec.key, {
            'min_role': spec.default_min_role,
            'allow_guest': spec.default_allow_guest,
        })

    if has_request_context():
        g._feature_gates = gates
    return gates


def gate_for(key):
    """The effective ``{'min_role', 'allow_guest'}`` for one feature."""
    return _load_gates().get(key)


def is_allowed(user, key):
    """
    Whether `user` may use the feature.

    Unknown keys are denied: a typo in a guard should fail closed, not open.
    """
    gate = gate_for(key)
    if gate is None:
        return False

    if user is None or not getattr(user, 'is_authenticated', False):
        return False

    spec = get_spec(key)
    if spec is not None and spec.guest_relevant and getattr(user, 'is_guest', False):
        if not gate['allow_guest']:
            return False

    required = _ROLE_RANK.get(gate['min_role'], 0)
    held = _ROLE_RANK.get(getattr(user, 'effective_role', ROLE_USER), 0)
    return held >= required


def permissions_for(user):
    """
    ``{feature_key: bool}`` for the whole catalog.

    Sent with the session so the frontend hides what the backend would refuse,
    from the same source of truth.
    """
    return {key: is_allowed(user, key) for key in FEATURE_KEYS}


def admin_view():
    """Catalog joined with current values, for the management panel."""
    gates = _load_gates()
    return [
        {**spec.to_dict(), **gates.get(spec.key, {})}
        for spec in FEATURE_CATALOG
    ]


def set_gate(key, min_role=None, allow_guest=None, updated_by_id=None):
    """
    Updates one gate. Returns the stored row.

    Raises ValueError for an unknown feature or role, so the caller can answer
    400 rather than silently writing a value nothing will honour.
    """
    spec = get_spec(key)
    if spec is None:
        raise ValueError(f'Unknown feature: {key}')

    row = FeatureGate.query.filter_by(key=key).first()
    if row is None:
        row = FeatureGate(
            key=key,
            min_role=spec.default_min_role,
            allow_guest=spec.default_allow_guest,
        )
        db.session.add(row)

    if min_role is not None:
        min_role = str(min_role).strip().lower()
        if min_role not in ROLES:
            raise ValueError(f'Unknown role: {min_role}')
        row.min_role = min_role

    if allow_guest is not None:
        row.allow_guest = bool(allow_guest)

    row.updated_by_id = updated_by_id
    db.session.commit()

    # Drop the per-request memo so a read later in this same request (the
    # response payload, for one) reflects the write instead of the old value.
    if has_request_context() and hasattr(g, '_feature_gates'):
        del g._feature_gates

    return row
