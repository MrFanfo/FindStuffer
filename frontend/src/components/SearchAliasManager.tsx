import { FormEvent, useEffect, useMemo, useState } from "react";

import { api, flattenLocations, Item, LocationNode, SearchAlias } from "../api";

export function SearchAliasManager({
  items,
  locations,
}: {
  items: Item[];
  locations: LocationNode[];
}) {
  const [aliases, setAliases] = useState<SearchAlias[]>([]);
  const [alias, setAlias] = useState("");
  const [targetType, setTargetType] = useState<SearchAlias["target_type"]>("term");
  const [replacement, setReplacement] = useState("");
  const [targetId, setTargetId] = useState("");
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Array<{
    normalized_query: string;
    original_query: string;
    search_count: number;
  }>>([]);
  const flatLocations = useMemo(() => flattenLocations(locations), [locations]);

  async function load() {
    const [nextAliases, nextCandidates] = await Promise.all([
      api.searchAliases(),
      api.searchLearningCandidates(),
    ]);
    setAliases(nextAliases);
    setCandidates(nextCandidates);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await api.createSearchAlias({
        alias,
        target_type: targetType,
        replacement: targetType === "term" ? replacement : "",
        target_public_id: targetType === "term" ? null : targetId,
      });
      setAlias("");
      setReplacement("");
      setTargetId("");
      await load();
      setMessage("Search alias saved");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not save alias");
    }
  }

  async function dismissCandidate(query: string) {
    setMessage("");
    try {
      await api.deleteSearchLearningCandidate(query);
      setCandidates((current) => current.filter((entry) => entry.normalized_query !== query));
      setMessage("Search suggestion removed");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not remove suggestion");
    }
  }

  return (
    <div className="search-alias-manager">
      <p>
        Teach Findstuff household language such as “top drawer,” spelling
        variants, or personal names for an item.
      </p>
      {candidates.length > 0 && (
        <div className="search-learning-candidates">
          <strong>Repeated searches with no result</strong>
          <div>
            {candidates.map((candidate) => (
              <span className="search-learning-candidate" key={candidate.normalized_query}>
                <button type="button" onClick={() => setAlias(candidate.original_query)}>
                  {candidate.original_query}
                  <small>{candidate.search_count} searches · teach this</small>
                </button>
                <button type="button" className="dismiss-candidate" aria-label={`Remove ${candidate.original_query} suggestion`} onClick={() => void dismissCandidate(candidate.normalized_query)}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={save}>
        <label>
          What people type
          <input
            required
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="top drawer"
          />
        </label>
        <label>
          Resolves to
          <select
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value as SearchAlias["target_type"]);
              setTargetId("");
              setReplacement("");
            }}
          >
            <option value="term">Another search term</option>
            <option value="item">A specific item</option>
            <option value="location">A Place and its items</option>
          </select>
        </label>
        {targetType === "term" ? (
          <label>
            Search instead for
            <input
              required
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="Phillips driver"
            />
          </label>
        ) : (
          <label>
            Target
            <select
              required
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">Choose…</option>
              {(targetType === "item" ? items : flatLocations).map((entry) => (
                <option value={entry.public_id} key={entry.public_id}>
                  {"location_path" in entry
                    ? `${entry.name} · ${entry.location_path}`
                    : entry.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="secondary">Add alias</button>
      </form>
      {message && <div className="inline-alert" role="status">{message}</div>}
      <div className="search-alias-list">
        {aliases.map((entry) => (
          <div key={entry.public_id}>
            <span>
              <strong>{entry.alias}</strong>
              <small>
                {entry.target_type === "term"
                  ? `searches for “${entry.replacement}”`
                  : `${entry.target_type} · ${entry.target_public_id}`}
                {entry.use_count ? ` · used ${entry.use_count}×` : ""}
              </small>
            </span>
            <button
              type="button"
              onClick={() => void api.deleteSearchAlias(entry.public_id).then(load)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
