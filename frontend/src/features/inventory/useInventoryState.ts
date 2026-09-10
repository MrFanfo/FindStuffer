import { useState } from "react";
import type { Item } from "../../api";
import type { InventoryFilter } from "./formula";

export function useInventoryState() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") || "");
  const [searchBusy, setSearchBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pendingItems, setPendingItems] = useState<Set<string>>(() => new Set());
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [tag, setTag] = useState("");
  const [includeZero, setIncludeZero] = useState(() => new URLSearchParams(location.search).get("zero") === "1");

  return {
    items,
    setItems,
    query,
    setQuery,
    searchBusy,
    setSearchBusy,
    nextCursor,
    setNextCursor,
    hasMore,
    setHasMore,
    pendingItems,
    setPendingItems,
    selectedItem,
    setSelectedItem,
    filter,
    setFilter,
    categoryId,
    setCategoryId,
    tag,
    setTag,
    includeZero,
    setIncludeZero,
  };
}
