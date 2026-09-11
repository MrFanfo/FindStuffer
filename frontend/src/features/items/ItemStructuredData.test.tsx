import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Item } from '../../api';
import { extensions, type CategoryField, type CompatibilityTarget, type ItemExtensions } from '../../extensionApi';
import { ItemStructuredData } from './ItemStructuredData';

vi.mock('../../extensionApi', () => ({ extensions: { item: vi.fn(), targets: vi.fn(), target: vi.fn() } }));
const item = { public_id: 'machine', version: 1 } as Item;
const target: CompatibilityTarget = { public_id: 'target', name: 'Ender 3', manufacturer: 'Creality', model: '', type: 'printer', aliases: [], parent: null, active: true, linked_item_ids: ['machine'] };
const empty: ItemExtensions = { custom_fields: {}, field_definitions: [], compatibility: [], compatibility_targets: [], projects: [] };
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(extensions.item).mockResolvedValue(empty); vi.mocked(extensions.targets).mockResolvedValue([target]); });

test('empty properties and relationships stay hidden, while edit offers target linking', async () => {
  const onDraftChange = vi.fn();
  const { rerender } = render(<ItemStructuredData item={item} onDraftChange={onDraftChange} />);
  await waitFor(() => expect(extensions.item).toHaveBeenCalled());
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  rerender(<ItemStructuredData item={item} editing onDraftChange={onDraftChange} />);
  await screen.findByRole('option', { name: 'Ender 3' });
  fireEvent.change(screen.getByLabelText(/This item is a physical instance/), { target: { value: 'target' } });
  expect(onDraftChange).toHaveBeenLastCalledWith({ compatibility: [], compatibility_targets: ['target'] });
  rerender(<ItemStructuredData item={item} editing relatedEnabled={false} onDraftChange={onDraftChange} />);
  expect(screen.queryByLabelText(/physical instance/)).not.toBeInTheDocument();
  expect(screen.queryByText('Add relationship')).not.toBeInTheDocument();
});

test('zero and false properties remain visible; unset fields do not', async () => {
  const fields = ['Voltage', 'Magnetic', 'Empty'].map((label, index) => ({ public_id: String(index), value_field_id: String(index), label, unit: '', default: null }) as CategoryField);
  vi.mocked(extensions.item).mockResolvedValue({ ...empty, field_definitions: fields, custom_fields: { '0': 0, '1': false } });
  render(<ItemStructuredData item={item} />);
  await screen.findByRole('heading', { name: 'Properties' });
  expect(screen.getByText('0')).toBeVisible();
  expect(screen.getByText('No')).toBeVisible();
  expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Related' })).not.toBeInTheDocument();
});

test('a physical machine shows compatible parts, inheritance and evidence in Related', async () => {
  vi.mocked(extensions.item).mockResolvedValue({ ...empty, compatibility_targets: [target] });
  vi.mocked(extensions.target).mockResolvedValue({ target, linked_items: [], total: 1, next_offset: null, projects: [], items: [{ ...item, public_id: 'part', name: 'Nozzle', quantity: '3', unit: 'pcs', location_path: 'Workshop > Drawer 2', effective_compatibility: { status: 'requires_adapter', inherited: true, source_name: 'Printer family', adapter: 'V2 mount', source_url: 'https://example.com/manual' } }] });
  render(<ItemStructuredData item={item} />);
  const part = await screen.findByRole('link', { name: 'Nozzle' });
  expect(part).toHaveAttribute('href', '?view=inventory&item=part');
  expect(screen.getByText(/inherited from Printer family/)).toBeVisible();
  expect(screen.getByText('Adapter: V2 mount')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Evidence' })).toHaveAttribute('href', 'https://example.com/manual');
  expect(screen.getAllByRole('heading', { name: 'Related' })).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'Works with' })).not.toBeInTheDocument();
});
