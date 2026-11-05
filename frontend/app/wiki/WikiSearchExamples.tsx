'use client';

import { useState } from 'react';

export function SearchWorkflow() {
  const steps = [
    ['Define the question', 'Identify the product set and the evidence you need.'],
    ['Build criteria', 'Enter conditions manually or review an AI draft.'],
    ['Inspect matches', 'Check scope, selected entities, and result filters.'],
    ['Read labeling', 'Confirm the version and examine the original passage.'],
    ['Choose an analysis', 'Use a Toolbox tool when the next question requires it.'],
  ];
  return <figure className="wiki-example">
    <figcaption><strong>From question to evidence</strong><span>Search workflow</span></figcaption>
    <ol className="wiki-workflow">{steps.map(([title, description], index) => <li key={title}>
      <span className="wiki-example-number">0{index + 1}</span><strong>{title}</strong><p>{description}</p>
    </li>)}</ol>
    <p className="wiki-example-note">Unexpected matches? Adjust the criteria and search again.</p>
  </figure>;
}

const RECORDS = [
  { id: 'Label A', route: 'Oral', term: true },
  { id: 'Label B', route: 'Oral', term: false },
  { id: 'Label C', route: 'Topical', term: true },
  { id: 'Label D', route: 'Topical', term: false },
];

export function CriteriaLogicExample() {
  const [mode, setMode] = useState<'both' | 'either'>('both');
  const matches = (record: typeof RECORDS[number]) => mode === 'both'
    ? record.route === 'Oral' && record.term : record.route === 'Oral' || record.term;
  const route = <span className="wiki-example-condition">Route = Oral</span>;
  const term = <span className="wiki-example-condition">Selected section contains “example term”</span>;
  return <figure className="wiki-example">
    <figcaption><strong>Try the grouping logic</strong><span>Illustrative example · fictional records</span></figcaption>
    <fieldset className="wiki-logic-options"><legend>What should a record satisfy?</legend>
      <label><input type="radio" name="wiki-logic-mode" checked={mode === 'both'} onChange={() => setMode('both')} /> Both conditions</label>
      <label><input type="radio" name="wiki-logic-mode" checked={mode === 'either'} onChange={() => setMode('either')} /> Either condition</label>
    </fieldset>
    <div className="wiki-example-groups" aria-label="Illustrative criteria groups">
      {mode === 'both' ? <div className="wiki-example-group"><strong>Group 1</strong>{route}<b>AND</b>{term}</div> : <>
        <div className="wiki-example-group"><strong>Group 1</strong>{route}</div><b className="wiki-example-or">OR</b><div className="wiki-example-group"><strong>Group 2</strong>{term}</div>
      </>}
    </div>
    <p className="wiki-example-note">{mode === 'both' ? 'Both required: only Label A matches.' : 'Either accepted: Labels A, B, and C match.'}</p>
    <div className="wiki-article-table"><table>
      <caption>Illustrative matches for four fictional labeling records</caption>
      <thead><tr><th scope="col">Record</th><th scope="col">Route</th><th scope="col">Example term present</th><th scope="col">Matches?</th></tr></thead>
      <tbody>{RECORDS.map(record => <tr key={record.id} data-matches={matches(record)}><th scope="row">{record.id}</th><td>{record.route}</td><td>{record.term ? 'Yes' : 'No'}</td><td>{matches(record) ? 'Included' : 'Excluded'}</td></tr>)}</tbody>
    </table></div>
    <p role="status" className="wiki-example-result">{RECORDS.filter(matches).length} of 4 records match.</p>
    <p className="wiki-example-note">Field-specific operators and name expansion are covered in the matching guide.</p>
  </figure>;
}
