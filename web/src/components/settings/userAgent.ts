import { appText } from "@/i18n/text";
/** "Chrome on macOS" from a user agent string. Good enough for a sessions list. */
export function describeUserAgent(ua: string): { label: string; mobile: boolean } {
  const s = ua || "";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /Firefox\//.test(s)
        ? "Firefox"
        : /Chrome\//.test(s)
          ? "Chrome"
          : /Safari\//.test(s)
            ? "Safari"
            : /curl|okhttp|python|Go-http/i.test(s)
              ? appText("API client")
              : appText("Browser");
  const os = /iPhone|iPad|iPod/.test(s)
    ? "iOS"
    : /Android/.test(s)
      ? "Android"
      : /Mac OS X|Macintosh/.test(s)
        ? "macOS"
        : /Windows/.test(s)
          ? "Windows"
          : /CrOS/.test(s)
            ? "ChromeOS"
            : /Linux/.test(s)
              ? "Linux"
              : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(s) };
}
