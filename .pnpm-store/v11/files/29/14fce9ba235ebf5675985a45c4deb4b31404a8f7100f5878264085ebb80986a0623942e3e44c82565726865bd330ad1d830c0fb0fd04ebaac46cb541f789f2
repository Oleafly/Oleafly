export interface UseLocationResult {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  origin: string;
  pathname: string;
  port: string;
  protocol: string;
  query: Record<string, string>;
  search: string;
}

export function useLocation(): UseLocationResult {
  const { hash, host, hostname, href, origin, pathname, port, protocol, search } = window.location;

  const query = search
    ? search
        .slice(1)
        .split('&')
        .reduce<Record<string, string>>((acc, pair) => {
          const [key, value] = pair.split('=');

          if (key && value) {
            acc[key] = value;
          }

          return acc;
        }, {})
    : {};

  return { hash, host, hostname, href, origin, pathname, port, protocol, query, search };
}
