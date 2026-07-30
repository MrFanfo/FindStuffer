export function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (!navigator.onLine) return "You're offline. The change was not saved.";
  if (!(error instanceof Error)) return fallback;
  if (error.message === "Failed to fetch") return "Could not reach Findstuff. Check the connection and try again.";
  if (error.message.includes("timed out")) return "Findstuff took too long to respond. Please try again.";
  return error.message || fallback;
}

export function isOfflineFailure(error: unknown): boolean {
  if (!navigator.onLine) return true;
  return error instanceof Error && (
    error.message === "Failed to fetch"
    || error.message.includes("NetworkError")
    || error.message.includes("Load failed")
  );
}
