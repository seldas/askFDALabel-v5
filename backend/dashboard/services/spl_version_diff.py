"""Version-pinned, whole-document SPL XML comparison helpers."""

import base64
import binascii
import difflib
import hashlib
import html
import json
import re
import xml.etree.ElementTree as StdET

try:
    import defusedxml.ElementTree as SafeET
except ImportError:
    SafeET = StdET

from dashboard.services.fdalabel_db import FDALabelDBService


def _semantic_records(xml_text):
    """Keep all XML values, expressing narrative text as sentences and table rows.

    Attributes (including inline references) remain separate records; no clinical
    or administrative elements are filtered out of the analysis.
    """
    root = SafeET.fromstring(xml_text)
    _compact_embedded_images(root)
    records = []

    def local(tag):
        return tag.rsplit('}', 1)[-1]

    def text(element):
        return re.sub(r'\s+', ' ', ''.join(element.itertext())).strip()

    def add(path, section, kind, value, context=None):
        if value:
            record = {'path': path, 'section': section, 'kind': kind, 'value': value}
            if context:
                record['context'] = context
            records.append(record)

    def walk(element, path, section='', narrative=False, table_context=None):
        tag = local(element.tag)
        if tag == 'section':
            title = next((text(child) for child in element if local(child.tag) == 'title'), '')
            section = f'{section} / {title}'.strip(' /') if title else section
        if tag == 'table':
            headers = [' | '.join(text(cell) for cell in row) for row in element.iter()
                       if local(row.tag) == 'tr' and any(local(cell.tag) == 'th' for cell in row)]
            notes = [text(child) for child in element.iter()
                     if local(child.tag) in {'caption', 'tfoot', 'footnote'}]
            table_context = {'headers': headers, 'notes': notes}
        add(path, section, 'attributes', dict(sorted(element.attrib.items())), table_context)
        if not len(element) and not element.attrib and not (element.text or '').strip():
            add(path, section, 'empty_element', tag)
        block = not narrative and tag in {'paragraph', 'item', 'tr'}
        if block:
            value = text(element)
            if tag == 'tr':
                value = ' | '.join(text(cell) for cell in element)
                add(path, section, 'table_row', value, table_context)
            else:
                sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', value)
                for index, sentence in enumerate(sentences):
                    add(f'{path}/sentence[{index + 1}]', section, 'sentence', sentence)
        elif not narrative:
            add(path, section, 'text', re.sub(r'\s+', ' ', element.text or '').strip())
        counts = {}
        for child in element:
            name = local(child.tag)
            # Section codes are more stable than document-wide section positions.
            code = next((node.get('code') for node in child if local(node.tag) == 'code'), None) if name == 'section' else None
            identity = f'{name}[code={code}]' if code else name
            counts[identity] = counts.get(identity, 0) + 1
            child_path = f'{path}/{identity}[{counts[identity]}]'
            walk(child, child_path, section, narrative or block, table_context)
            if not (narrative or block):
                add(child_path + '/tail', section, 'text', re.sub(r'\s+', ' ', child.tail or '').strip())

    walk(root, '/' + local(root.tag))
    return records


def compact_spl_changes(previous_xml, current_xml):
    """Group content-matched changes by section; share context per change/table.

    Source paths are retained separately for debugging, not repeated in the AI
    input. Positional indexes never participate in content matching.
    """
    old = _semantic_records(previous_xml)
    new = _semantic_records(current_xml)

    def section_key(record):
        codes = re.findall(r'/section\[code=([^\]]+)\]', record['path'])
        return ('codes', tuple(codes)) if codes else ('title', record['section'])

    def signature(record):
        location = re.sub(r'\[\d+\]', '', record['path'])
        return (location, record['kind'], json.dumps(record['value'], sort_keys=True, ensure_ascii=False))

    def groups(records):
        result = {}
        for record in records:
            result.setdefault(section_key(record), []).append(record)
        return result

    old_groups, new_groups = groups(old), groups(new)
    output, sources = [], {}
    change_number = 0
    old_order = [key for key in old_groups if key in new_groups]
    new_order = [key for key in new_groups if key in old_groups]
    if old_order != new_order:
        def section_names(keys, grouped):
            return ' | '.join(grouped[key][0]['section'] or 'Document metadata' for key in keys)

        change_number += 1
        output.append('SECTION: Document structure\nC1\n- Section order: '
                      + section_names(old_order, old_groups) + '\n+ Section order: '
                      + section_names(new_order, new_groups))
        sources['C1'] = {
            'previous_paths': [old_groups[key][0]['path'] for key in old_order],
            'current_paths': [new_groups[key][0]['path'] for key in new_order],
        }
    for key in dict.fromkeys([*old_groups, *new_groups]):
        previous, current = old_groups.get(key, []), new_groups.get(key, [])
        matcher = difflib.SequenceMatcher(None, list(map(signature, previous)),
                                        list(map(signature, current)), autojunk=False)
        section_output, tables = [], {}

        def render(record, side):
            value = record['value']
            if record['kind'] == 'attributes':
                # Attribute-bearing element identity matters; numeric positions
                # are retained in the source map rather than the prompt.
                name = re.sub(r'\[\d+\]', '', record['path']).rsplit('/', 1)[-1]
                value = name + ' ' + json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            elif record['kind'] == 'empty_element':
                value = '<' + value + '/>'
            prefix = ''
            context = record.get('context', {})
            if 'headers' in context:
                table_match = re.match(r'^(.*?/table(?:\[\d+\])?)(?:/|$)', record['path'])
                table_path = table_match.group(1) if table_match else record['path']
                # Different before/after headers or notes must both be retained.
                table_key = (table_path, json.dumps(context, sort_keys=True))
                if table_key not in tables:
                    table_id = f'T{len(tables) + 1}'
                    tables[table_key] = table_id
                    section_output.append(f'{table_id} ({side}) headers: ' + ' ; '.join(context['headers']))
                    if context['notes']:
                        section_output.append(f'{table_id} notes: ' + ' ; '.join(context['notes']))
                prefix = tables[table_key] + ' | '
            return prefix + str(value)

        # One neighboring record on each side, shared by a whole change block.
        for group in matcher.get_grouped_opcodes(n=1):
            change_number += 1
            change_id = f'C{change_number}'
            section_output.append(change_id)
            source = {'previous_paths': [], 'current_paths': []}
            sources[change_id] = source
            for tag, a, b, c, d in group:
                if tag == 'equal':
                    for record in current[c:d]:
                        section_output.append('  ' + render(record, 'current'))
                else:
                    for record in previous[a:b]:
                        section_output.append('- ' + render(record, 'previous'))
                        source['previous_paths'].append(record['path'])
                    for record in current[c:d]:
                        section_output.append('+ ' + render(record, 'current'))
                        source['current_paths'].append(record['path'])
        if section_output:
            titles = list(dict.fromkeys(record['section'] or 'Document metadata' for record in previous + current))
            output.append('SECTION: ' + ' -> '.join(titles) + '\n' + '\n'.join(section_output))
    return '\n\n'.join(output), sources


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


def compare_spl_xml(current_spl_id, previous_spl_id, *, include_analysis=False):
    """Compare the complete XML documents and return display hunks and AI diff."""
    current_xml = _load_exact_spl_xml(current_spl_id)
    previous_xml = _load_exact_spl_xml(previous_spl_id)
    if current_xml is None or previous_xml is None:
        return None

    current_lines = canonical_spl_lines(current_xml)
    previous_lines = canonical_spl_lines(previous_xml)
    matcher = difflib.SequenceMatcher(None, previous_lines, current_lines, autojunk=True)
    results = []
    xml_diff = []

    for index, group in enumerate(matcher.get_grouped_opcodes(n=3), start=1):
        old_html, new_html, plain = _render_group(previous_lines, current_lines, group)
        changed = any(tag != 'equal' for tag, *_ in group)
        if not changed:
            continue
        if include_analysis:
            xml_diff.append(plain)
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

    compact_diff, sources = compact_spl_changes(previous_xml, current_xml) if include_analysis else ('', {})
    return {
        'diff': results,
        'analysis_candidates': {'xml_diff': '\n\n'.join(xml_diff), 'compact_diff': compact_diff} if include_analysis else {},
        'analysis_sources': sources,
        'current_lines': len(current_lines),
        'previous_lines': len(previous_lines),
    }
