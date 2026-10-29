"""Validate and repair query shapes before sanitizers and compilers access their fields."""


class QueryShapeError(ValueError):
    pass


def heal_raw_query(query):
    """
    Tolerantly repairs minor schema deviations in raw AI-generated query payloads
    before strict validation and compilation.
    """
    if not isinstance(query, dict):
        return {'groups': [], 'prefilters': [], 'notes': []}

    # Ensure prefilters is a list of valid objects
    raw_prefilters = query.get('prefilters')
    healed_prefilters = []
    if isinstance(raw_prefilters, list):
        for item in raw_prefilters:
            if isinstance(item, dict) and isinstance(item.get('type'), str):
                val = item.get('value')
                if isinstance(val, list):
                    for v in val:
                        healed_prefilters.append({
                            'type': str(item['type']),
                            'value': str(v or '').strip(),
                            'label': str(item.get('label') or v or '').strip(),
                        })
                else:
                    healed_prefilters.append({
                        'type': str(item['type']),
                        'value': str(val or '').strip(),
                        'label': str(item.get('label') or val or '').strip(),
                    })
            elif isinstance(item, str) and item.strip():
                healed_prefilters.append({'type': 'route', 'value': item.strip(), 'label': item.strip()})
    query['prefilters'] = healed_prefilters

    # Ensure notes is a list of strings
    raw_notes = query.get('notes')
    if isinstance(raw_notes, list):
        query['notes'] = [str(n) for n in raw_notes if n is not None]
    elif isinstance(raw_notes, str):
        query['notes'] = [raw_notes]
    else:
        query['notes'] = []

    # Ensure groups is a list
    raw_groups = query.get('groups')
    if not isinstance(raw_groups, list):
        query['groups'] = []
        return query

    healed_groups = []
    for group in raw_groups:
        if not isinstance(group, dict):
            continue
        raw_criteria = group.get('criteria')
        if not isinstance(raw_criteria, list):
            continue

        healed_criteria = []
        for crit in raw_criteria:
            if not isinstance(crit, dict):
                continue
            ctype = crit.get('type')
            if not isinstance(ctype, str) or not ctype.strip():
                continue
            ctype = ctype.strip()

            value = crit.get('value')

            # 1. Handle value being None, boolean, number
            if value is None or isinstance(value, (bool, int, float)):
                if ctype == 'productName':
                    value = {'field': 'any', 'op': 'equals', 'text': ''}
                elif ctype in ('fullText', 'labelingSection'):
                    value = {'mode': 'simple', 'text': ''}
                elif ctype == 'meddra':
                    value = {'level': 'pt', 'terms': [], 'sections': []}
                elif ctype == 'pharmClass':
                    value = {'classType': 'any', 'terms': []}
                else:
                    value = {}

            # 2. Handle string value
            elif isinstance(value, str):
                if ctype == 'productName':
                    value = {'field': 'any', 'op': 'equals', 'text': value}
                elif ctype in ('fullText', 'labelingSection'):
                    value = {'mode': 'simple', 'text': value}
                elif ctype == 'meddra':
                    value = {'level': 'pt', 'terms': [value], 'sections': []}
                elif ctype == 'pharmClass':
                    value = {'classType': 'any', 'terms': [value]}
                else:
                    value = {'values': [value]}

            # 3. Handle list value
            elif isinstance(value, list):
                str_items = [str(v) for v in value if v is not None and not isinstance(v, (dict, list))]
                if ctype == 'productName':
                    value = {'field': 'any', 'op': 'equals', 'text': ' '.join(str_items)}
                elif ctype in ('fullText', 'labelingSection'):
                    value = {'mode': 'simple', 'text': ' '.join(str_items)}
                elif ctype == 'meddra':
                    value = {'level': 'pt', 'terms': str_items, 'sections': []}
                elif ctype == 'pharmClass':
                    value = {'classType': 'any', 'terms': str_items}
                else:
                    value = {'values': str_items}

            # 4. Handle dict value (standardize inner fields)
            elif isinstance(value, dict):
                norm_val = dict(value)

                # Fix array fields
                for arr_key in (
                    'terms', 'values', 'sections', 'ptTerms', 'lltTerms',
                    'setSplGuids', 'candidateNames', 'entityOriginalNames', 'entityExcludedNames'
                ):
                    if arr_key in norm_val:
                        raw_arr = norm_val[arr_key]
                        if raw_arr is None:
                            norm_val[arr_key] = []
                        elif isinstance(raw_arr, str):
                            norm_val[arr_key] = [raw_arr] if raw_arr.strip() else []
                        elif isinstance(raw_arr, (int, float)):
                            norm_val[arr_key] = [str(raw_arr)]
                        elif isinstance(raw_arr, list):
                            cleaned_list = []
                            for el in raw_arr:
                                if el is None:
                                    continue
                                if isinstance(el, dict):
                                    val_str = el.get('term') or el.get('name') or el.get('text') or ''
                                    if val_str:
                                        cleaned_list.append(str(val_str))
                                else:
                                    cleaned_list.append(str(el))
                            norm_val[arr_key] = cleaned_list
                        else:
                            norm_val[arr_key] = []

                # Fix string fields
                for str_key in (
                    'text', 'field', 'op', 'mode', 'level',
                    'applNum', 'applKind', 'uniiCode', 'setSplGuid'
                ):
                    if str_key in norm_val:
                        raw_str = norm_val[str_key]
                        if raw_str is None:
                            norm_val[str_key] = ''
                        elif isinstance(raw_str, list):
                            norm_val[str_key] = ' '.join(str(s) for s in raw_str if s is not None)
                        elif not isinstance(raw_str, str):
                            norm_val[str_key] = str(raw_str)

                value = norm_val

            # Drop empty placeholder productName (e.g. text="" and no candidateNames)
            if ctype == 'productName' and isinstance(value, dict):
                p_text = str(value.get('text') or '').strip()
                p_cands = value.get('candidateNames') or []
                if not p_text and not p_cands:
                    continue

            # Drop empty meddra (no terms)
            if ctype == 'meddra' and isinstance(value, dict):
                terms = value.get('terms') or []
                llts = value.get('lltTerms') or []
                pts = value.get('ptTerms') or []
                if not terms and not llts and not pts:
                    continue

            # Drop empty pharmClass (no terms)
            if ctype == 'pharmClass' and isinstance(value, dict):
                terms = value.get('terms') or []
                if not terms:
                    continue

            healed_criteria.append({'type': ctype, 'value': value})

        if healed_criteria or not healed_groups:
            healed_groups.append({'criteria': healed_criteria})

    if healed_groups and all(not g.get('criteria') for g in healed_groups):
        healed_groups = []

    query['groups'] = healed_groups
    return query


def validate_query_shape(query):
    def require(condition, path, expected):
        if not condition:
            raise QueryShapeError(f'{path} must be {expected}.')

    require(isinstance(query, dict), 'query', 'an object')
    groups = query.get('groups')
    require(groups is None or isinstance(groups, list), 'groups', 'an array')
    for i, group in enumerate(groups or []):
        path = f'groups[{i}]'
        require(isinstance(group, dict), path, 'an object')
        criteria = group.get('criteria')
        require(criteria is None or isinstance(criteria, list), path + '.criteria', 'an array')
        for j, criterion in enumerate(criteria or []):
            path_c = f'{path}.criteria[{j}]'
            require(isinstance(criterion, dict), path_c, 'an object')
            require(isinstance(criterion.get('type'), str), path_c + '.type', 'a string')
            value = criterion.get('value')
            require(isinstance(value, (dict, str, list)), path_c + '.value', 'an object, string, or array')
            if isinstance(value, list):
                require(all(isinstance(v, str) for v in value), path_c + '.value', 'an array of strings')
            if not isinstance(value, dict):
                continue
            for key, item in value.items():
                if key in ('text', 'field', 'op', 'mode', 'level', 'applNum', 'applKind', 'uniiCode', 'setSplGuid'):
                    require(item is None or isinstance(item, str), path_c + '.value.' + key, 'a string')
                if key in ('terms', 'values', 'sections', 'ptTerms', 'lltTerms', 'setSplGuids', 'candidateNames', 'entityOriginalNames', 'entityExcludedNames'):
                    require(item is None or (isinstance(item, list) and all(isinstance(v, str) for v in item)), path_c + '.value.' + key, 'an array of strings')
    for key in ('notes', 'prefilters'):
        require(query.get(key) is None or isinstance(query[key], list), key, 'an array')
    require(all(isinstance(note, str) for note in query.get('notes') or []), 'notes', 'an array of strings')
    for i, item in enumerate(query.get('prefilters') or []):
        require(isinstance(item, dict), f'prefilters[{i}]', 'an object')
        require(isinstance(item.get('type'), str), f'prefilters[{i}].type', 'a string')
