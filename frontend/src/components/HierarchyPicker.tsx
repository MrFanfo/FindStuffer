import { FormEvent, useState } from "react";

import { Category, LocationNode } from "../api";
import { Icon } from "./Icon";

export type PickerNode = {
  id: string;
  name: string;
  path: string;
  meta?: string;
  children: PickerNode[];
};

export function locationPickerNodes(nodes: LocationNode[]): PickerNode[] {
  return nodes.map((node) => ({
    id: node.public_id,
    name: node.name,
    path: node.path,
    children: locationPickerNodes(node.children),
  }));
}

export function categoryPickerNodes(categories: Category[]): PickerNode[] {
  const nodes = new Map<number, Category & { children: Category[] }>(
    categories.map((category) => [category.id, { ...category, children: [] }]),
  );
  const roots: Array<Category & { children: Category[] }> = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id === null ? null : nodes.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const convert = (category: Category & { children: Category[] }): PickerNode => ({
    id: String(category.id),
    name: category.name,
    path: category.path || category.name,
    meta: category.default_location ? `Default: ${category.default_location.name}` : undefined,
    children: category.children
      .sort((left, right) => (left.path || left.name).localeCompare(right.path || right.name))
      .map((child) => convert(child as Category & { children: Category[] })),
  });
  return roots
    .sort((left, right) => (left.path || left.name).localeCompare(right.path || right.name))
    .map(convert);
}

export function findPickerNode(nodes: PickerNode[], id: string): PickerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findPickerNode(node.children, id);
    if (child) return child;
  }
  return null;
}

export function HierarchyPicker({
  title,
  nodes,
  selectedId,
  emptyLabel,
  createPlaceholder,
  chooseLabel = "Choose",
  currentChooseLabel,
  onChoose,
  onCreate,
  onClose,
}: {
  title: string;
  nodes: PickerNode[];
  selectedId: string;
  emptyLabel: string;
  createPlaceholder?: string;
  chooseLabel?: string;
  currentChooseLabel?: string;
  onChoose: (id: string) => void;
  onCreate?: (parentId: string | null, name: string) => Promise<string>;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  const [name, setName] = useState("");
  const current = path.length ? findPickerNode(nodes, path[path.length - 1]) : null;
  const children = current ? current.children : nodes;
  const selected = selectedId ? findPickerNode(nodes, selectedId) : null;

  async function createHere(event: FormEvent) {
    event.preventDefault();
    if (!onCreate) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = await onCreate(current?.id || null, trimmed);
    setName("");
    onChoose(id);
    onClose();
  }

  return (
    <div
      className="modal-backdrop picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="picker-sheet">
        <header>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close picker">
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <div className="picker-context">
              <span>{current ? current.path : "Top level"}</span>
              {selected && <span>Selected: {selected.path}</span>}
            </div>
          </div>
        </header>
        {path.length > 0 && (
          <button
            className="text-button picker-back"
            type="button"
            onClick={() => setPath((currentPath) => currentPath.slice(0, -1))}
          >
            Back up
          </button>
        )}
        {current && currentChooseLabel && (
          <button
            className="primary picker-current-action"
            type="button"
            onClick={() => {
              onChoose(current.id);
              onClose();
            }}
          >
            {currentChooseLabel}
          </button>
        )}
        <div className="picker-list">
          {children.length === 0 && <div className="empty-inline"><span>{emptyLabel}</span></div>}
          {children.map((node) => (
            <div
              className={`picker-row ${node.children.length === 0 ? "no-drill" : ""} ${selectedId === node.id ? "selected" : ""}`}
              key={node.id}
            >
              <button
                type="button"
                onClick={() => {
                  onChoose(node.id);
                  onClose();
                }}
              >
                <strong>{node.name}</strong>
                <small>{node.path}{node.meta ? ` · ${node.meta}` : ""}</small>
                <em>{chooseLabel}</em>
              </button>
              {node.children.length > 0 && (
                <button
                  type="button"
                  aria-label={`Open ${node.name}`}
                  onClick={() => setPath((currentPath) => [...currentPath, node.id])}
                >
                  <Icon name="chevron" size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        {onCreate && (
          <form className="picker-create" onSubmit={createHere}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={createPlaceholder}
            />
            <button className="secondary" disabled={!name.trim()}>Create here</button>
          </form>
        )}
      </article>
    </div>
  );
}
