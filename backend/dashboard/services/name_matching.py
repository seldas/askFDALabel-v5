"""Search spellings without changing stored drug or MedDRA names."""

import re
from itertools import product


def separator_variants(text):
    """Keep each ASCII space/hyphen as one separator, never delete it.

    Bounded expansion keeps ordinary predicates usable by existing indexes.
    Long names use the SQL normalization fallback instead of exponential binds.
    """
    positions = [i for i, char in enumerate(text) if char in ' -']
    if len(positions) > 6:
        return None
    variants = [text]
    for separators in product(' -', repeat=len(positions)):
        chars = list(text)
        for position, separator in zip(positions, separators):
            chars[position] = separator
        value = ''.join(chars)
        if value not in variants:
            variants.append(value)
    return variants


def name_match_sql(column, text, bind, *, oracle=False, exact=False, equals=False):
    """Build a bound, case-insensitive LIKE predicate; exact keeps separators.

    column is a trusted code-owned SQL expression, never user input. bind adds
    a value to the caller's parameter collection and returns its placeholder.
    """
    variants = [text] if exact else separator_variants(text)
    if variants is None:
        column = f"REPLACE({column}, '-', ' ')"
        variants = [text.replace('-', ' ')]
    if equals:
        clauses = [f'UPPER({column}) = UPPER({bind(value)})' for value in variants]
    elif oracle:
        clauses = [f'UPPER({column}) LIKE UPPER({bind(value)})' for value in variants]
    else:
        clauses = [f'{column} ILIKE {bind(value)}' for value in variants]
    return '(' + ' OR '.join(clauses) + ')'


class NameSearchParams:
    """Bind search spellings alongside an endpoint's existing named params."""

    def __init__(self, params=None, *, oracle=False):
        self.params = dict(params or {})
        self.oracle = oracle

    def bind(self, value):
        key = f'name_match_{len(self.params)}'
        while key in self.params:
            key += '_'
        self.params[key] = value
        return f':{key}' if self.oracle else f'%({key})s'

    def match(self, column, text, *, exact=False, equals=False):
        return name_match_sql(column, text, self.bind, oracle=self.oracle, exact=exact, equals=equals)

    def for_sql(self, sql, params=None):
        values = {**self.params, **(params or {})}
        if self.oracle:
            # Oracle rejects unused binds; count and page SQL can use subsets.
            used = set(re.findall(r'(?<!:):([A-Za-z_][A-Za-z_0-9]*)', sql))
            values = {key: value for key, value in values.items() if key in used}
        return values
