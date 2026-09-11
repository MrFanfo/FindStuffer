import { Icon } from '../../components/Icon';
import { quantity, type Requirement } from '../../extensionApi';

export function RequirementRow({ entry, projectStatus, busy, onOpenItem, onEdit, onLink, onStock, onPatch }: {
  entry: Requirement;
  projectStatus: string;
  busy: boolean;
  onOpenItem: () => void;
  onEdit: () => void;
  onLink: () => void;
  onStock: () => void;
  onPatch: (data: Record<string, unknown>) => void;
}) {
  const have = quantity(Number(entry.inventory_quantity_available) + Number(entry.acquired_quantity));
  const reserved = entry.reserve && ['planned', 'active'].includes(projectStatus) && Number(entry.inventory_quantity) > 0;
  return <article className={`requirement-card ${entry.optional ? 'optional' : ''} ${entry.satisfied ? 'satisfied' : ''}`}>
    <details className="requirement-disclosure">
      <summary className="requirement-summary">
        <span className="requirement-name">{entry.item_photo_url && <img src={entry.item_photo_url} alt="" />}<span><strong>{entry.name}</strong><small>{entry.unit}{entry.optional ? ' · Optional' : ''}</small></span></span>
        <span className="requirement-totals">{[['Need', entry.scaled_required_quantity], ['Have', have], ['Ordered', entry.purchased_quantity], ['To buy', entry.to_buy_quantity]].map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</span>
        <span className={`planning-status ${entry.satisfied ? 'covered' : ''}`}>{entry.status === 'cancelled' ? 'Cancelled' : entry.satisfied ? 'Covered' : `Missing ${entry.missing_quantity} ${entry.unit}`}</span>
        <Icon name="chevron" size={15} />
      </summary>
      <div className="requirement-expanded">
        <dl className="requirement-stock-facts">
          <div><dt>Available inventory</dt><dd>{entry.inventory_quantity_available} {entry.unit}</dd></div>
          <div><dt>Received outside inventory</dt><dd>{entry.acquired_quantity} {entry.unit}</dd></div>
          <div><dt>{reserved ? 'Reserved' : 'Allocation requested'}</dt><dd>{entry.inventory_quantity} {entry.unit}</dd></div>
        </dl>
        {entry.notes && <p className="requirement-notes">{entry.notes}</p>}
        {entry.warnings.length > 0 && <ul className="requirement-warnings">{entry.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <div className="requirement-action-bar"><div className="requirement-actions requirement-stock-actions">
          <button disabled={busy || Number(entry.to_buy_quantity) === 0} onClick={() => onPatch({ purchased_quantity: quantity(Number(entry.purchased_quantity) + Number(entry.to_buy_quantity)) })}>Order remaining</button>
          <button disabled={busy || Number(entry.missing_quantity) === 0} onClick={() => { const amount = Math.min(1, Number(entry.missing_quantity)); onPatch({ acquired_quantity: quantity(Number(entry.acquired_quantity) + amount), purchased_quantity: quantity(Math.max(0, Number(entry.purchased_quantity) - amount)) }); }}>Receive 1</button>
        </div><div className="requirement-actions requirement-manage-actions">
          <button disabled={busy} onClick={onEdit}>Edit quantities</button>
          {entry.item && <button disabled={busy} onClick={onOpenItem}>Open item</button>}
          <details className="requirement-more"><summary>More actions</summary><div className="requirement-actions">
            <button disabled={busy} onClick={onLink}>{entry.item ? 'Change linked stock' : 'Link inventory'}</button>
            {entry.item && <button disabled={busy || Number(entry.missing_quantity) === 0} onClick={() => onPatch({ inventory_quantity: quantity(Number(entry.inventory_quantity) + Math.min(1, Number(entry.missing_quantity))) })}>Use 1 from inventory</button>}
            <button disabled={busy || Number(entry.acquired_quantity) === 0} onClick={() => onPatch({ acquired_quantity: quantity(Math.max(0, Number(entry.acquired_quantity) - 1)) })}>Undo receipt of 1</button>
            <button disabled={busy || Number(entry.acquired_quantity) === 0} onClick={onStock}>Put received stock in inventory</button>
          </div></details>
        </div></div>
      </div>
    </details>
  </article>;
}
