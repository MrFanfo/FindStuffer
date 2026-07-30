import { Icon, IconName } from "./Icon";

export function EmptyState({
  icon = "box",
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-state">
      <span><Icon name={icon} size={27} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <button className="secondary" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
