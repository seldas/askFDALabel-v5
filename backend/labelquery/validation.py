"""Validate query shapes before sanitizers and compilers access their fields."""


class QueryShapeError(ValueError):
    pass


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

