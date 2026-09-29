"""Version-pinned, whole-document SPL XML comparison helpers."""

import base64
import binascii
import difflib
import hashlib
import html
import re
import xml.etree.ElementTree as StdET

try:
    import defusedxml.ElementTree as SafeET
except ImportError:
    SafeET = StdET

from dashboard.services.fdalabel_db import FDALabelDBService


def _load_exact_spl_xml(spl_id):
    metadata = FDALabelDBService.get_metadata_by_spl_id(spl_id)
    if not metadata or not metadata.get('set_id'):
        return None
    xml, source = FDALabelDBService.resolve_spl_xml(metadata['set_id'], spl_id=spl_id)
    if not xml or (source and source.get('spl_id') and source['spl_id'] != spl_id):
        return None
    return xml


def _compact_embedded_images(root):
    """Replace inline base64 image bodies with stable binary fingerprints."""
    for element in root.iter():
        media_type = next(
            (value for key, value in element.attrib.items()
             if key.rsplit('}', 1)[-1].lower() in {'mediatype', 'media-type'}),
            '',
        ).lower()
        if not media_type.startswith('image/') or not element.text or not element.text.strip():
            continue
        encoded = re.sub(r'\s+', '', element.text)
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            image_bytes = encoded.encode('ascii', errors='replace')
        digest = hashlib.sha256(image_bytes).hexdigest()
        element.text = f'[embedded image media_type={media_type} bytes={len(image_bytes)} sha256={digest}]'


def canonical_spl_lines(xml_text):
    """Return stable, readable whole-SPL XML lines with image payloads compacted."""
    root = SafeET.fromstring(xml_text)
    _compact_embedded_images(root)

    for element in root.iter():
        if element.attrib:
            sorted_attributes = sorted(element.attrib.items())
            element.attrib.clear()
            element.attrib.update(sorted_attributes)
        # Ignore indentation-only XML formatting while preserving meaningful
        # single spaces between inline text elements.
        if element.text is not None and not element.text.strip() and ('\n' in element.text or '\r' in element.text):
            element.text = None
        if element.tail is not None and not element.tail.strip() and ('\n' in element.tail or '\r' in element.tail):
            element.tail = None

    StdET.indent(root, space='  ')
    return StdET.tostring(root, encoding='unicode', short_empty_elements=True).splitlines()


def _render_group(old_lines, new_lines, group):
    old_html, new_html, plain = [], [], []
    for tag, old_start, old_end, new_start, new_end in group:
        old_chunk = '\n'.join(html.escape(line) for line in old_lines[old_start:old_end])
        new_chunk = '\n'.join(html.escape(line) for line in new_lines[new_start:new_end])
        if tag == 'equal':
            old_html.append(old_chunk)
            new_html.append(new_chunk)
            plain.extend(old_lines[old_start:old_end])
        elif tag == 'delete':
            old_html.append(f'<del class="diff-sub">{old_chunk}</del>')
            plain.extend(f'- {line}' for line in old_lines[old_start:old_end])
        elif tag == 'insert':
            new_html.append(f'<ins class="diff-add">{new_chunk}</ins>')
            plain.extend(f'+ {line}' for line in new_lines[new_start:new_end])
        else:
            old_html.append(f'<del class="diff-sub">{old_chunk}</del>')
            new_html.append(f'<ins class="diff-add">{new_chunk}</ins>')
            plain.extend(f'- {line}' for line in old_lines[old_start:old_end])
            plain.extend(f'+ {line}' for line in new_lines[new_start:new_end])
    return '\n'.join(old_html), '\n'.join(new_html), '\n'.join(plain)


def compare_spl_xml(current_spl_id, previous_spl_id):
    """Compare the complete XML documents and return display hunks and AI diff."""
    current_xml = _load_exact_spl_xml(current_spl_id)
    previous_xml = _load_exact_spl_xml(previous_spl_id)
    if current_xml is None or previous_xml is None:
        return None

    current_lines = canonical_spl_lines(current_xml)
    previous_lines = canonical_spl_lines(previous_xml)
    matcher = difflib.SequenceMatcher(None, previous_lines, current_lines, autojunk=True)
    results = []
    ai_diff = []

    for index, group in enumerate(matcher.get_grouped_opcodes(n=3), start=1):
        old_html, new_html, plain = _render_group(previous_lines, current_lines, group)
        changed = any(tag != 'equal' for tag, *_ in group)
        if not changed:
            continue
        old_line = group[0][1] + 1
        new_line = group[0][3] + 1
        results.append({
            'key': f'xml-hunk-{index}',
            'title': f'SPL XML change block {index} (current line {new_line}, previous line {old_line})',
            'diff_new': new_html,
            'diff_old': old_html,
            'is_addition': all(tag in {'equal', 'insert'} for tag, *_ in group),
            'is_deletion': all(tag in {'equal', 'delete'} for tag, *_ in group),
        })
        ai_diff.append(plain)

    return {
        'diff': results,
        'ai_diff': '\n\n'.join(ai_diff),
        'current_lines': len(current_lines),
        'previous_lines': len(previous_lines),
    }
