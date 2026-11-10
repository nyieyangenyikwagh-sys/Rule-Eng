/** Calling-app integration. Authentication/configuration failures also route to review. */
export async function evaluateWithFallback(
  baseUrl: string,
  apiKey: string,
  body: unknown,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const response = await fetch(`${baseUrl}/api/v1/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!response.ok) return unavailable();
      return await response.json();
    } catch {
      if (attempt === 1) return unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}
const unavailable = () => ({
  outcome: "PEND",
  primary_reason_code: "ENGINE_UNAVAILABLE",
  review_prompts: ["Rules service unavailable; route to an adjuster"],
});
