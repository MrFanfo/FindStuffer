import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ImportReviewEditor } from './ImportReviewEditor';

function Review() {
  const [payload, setPayload] = useState<unknown>({ schema_version: 2, operations: [{ op: 'add', type: 'item', data: { name: 'Fitting', quantity: 3 } }] });
  const [dirty, setDirty] = useState(false);
  return <><ImportReviewEditor payload={payload} details={[]} categories={[]} locations={[]} onChange={setPayload} onDraftChange={setDirty} busy={false} /><button disabled={dirty}>Apply file</button><output>{JSON.stringify(payload)}</output></>;
}

test('unfinished row edits block apply until saved or discarded', async () => {
  render(<Review />);
  expect(screen.queryByText('Edit item fields and destination')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
  fireEvent.click(screen.getByText('Edit item fields and destination'));
  fireEvent.change(screen.getByLabelText('Absolute quantity'), { target: { value: '7' } });
  await waitFor(() => expect(screen.getByText('Apply file')).toBeDisabled());
  fireEvent.click(screen.getByText('Save field edits'));
  await waitFor(() => expect(screen.getByText('Apply file')).toBeEnabled());
  expect(screen.getByRole('status').textContent).toContain('"quantity":"7"');
  fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
  fireEvent.click(screen.getByText('Edit all fields as JSON'));
  fireEvent.change(screen.getByLabelText('Complete operation JSON'), { target: { value: '{invalid' } });
  await waitFor(() => expect(screen.getByText('Apply file')).toBeDisabled());
  fireEvent.click(screen.getByText('Save JSON edits'));
  expect(screen.getByText('Apply file')).toBeDisabled();
  fireEvent.click(screen.getByText('Discard unsaved row edits'));
  await waitFor(() => expect(screen.getByText('Apply file')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Reject operation 1' }));
  expect(screen.getByRole('status').textContent).toContain('"operations":[]');
});
