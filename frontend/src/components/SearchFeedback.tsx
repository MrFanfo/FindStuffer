type Props = {
  query: string;
  onAdd: () => void;
  onFindLost: () => void;
};

export function SearchFeedback({ query, onAdd, onFindLost }: Props) {
  return (
    <div className="search-feedback" role="status">
      <strong>No inventory result for “{query}”</strong>
      <p>
        Try a shorter term, a singular word, a place alias, or choose what should
        happen next.
      </p>
      <div>
        <button className="primary" type="button" onClick={onAdd}>
          Add “{query}”
        </button>
        <button className="secondary" type="button" onClick={onFindLost}>
          Find an item to mark lost
        </button>
      </div>
    </div>
  );
}
