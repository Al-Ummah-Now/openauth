/**
 * Simple cookie jar for E2E tests
 * Maintains cookies between requests like a real browser
 */

export class CookieJar {
  private cookies: Map<string, string> = new Map()

  /**
   * Extract cookies from response Set-Cookie headers
   */
  extractFromResponse(response: Response): void {
    const setCookieHeaders = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie")?.split(",") || []

    for (const setCookie of setCookieHeaders) {
      const [cookiePair] = setCookie.split(";")
      const [name, value] = cookiePair.split("=")
      if (name && value) {
        this.cookies.set(name.trim(), value.trim())
      }
    }
  }

  /**
   * Get Cookie header value for requests
   */
  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ")
  }

  /**
   * Make a fetch request with cookies
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {})

    // Add existing cookies to request
    const cookieHeader = this.getCookieHeader()
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader)
    }

    const response = await fetch(url, {
      ...init,
      headers,
      redirect: init?.redirect || "manual",
    })

    // Extract cookies from response
    this.extractFromResponse(response)

    return response
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear()
  }
}
