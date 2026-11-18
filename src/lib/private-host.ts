const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/** This computer, or an address on a home or office network: a private IPv4 range, a name without a dot, or .local, .lan, .internal, .home.arpa. */
export function isPrivateHost(hostname: string): boolean {
  const ip = IPV4.exec(hostname);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return hostname === "[::1]" || !hostname.includes(".") || /\.(local|lan|internal|home\.arpa)$/.test(hostname);
}

/** Whether an address is on this computer or its network (E34, ST3); one that can't be read isn't. */
export function isPrivateAddress(address: string): boolean {
  const url = URL.canParse(address) ? new URL(address) : null;
  return url !== null && isPrivateHost(url.hostname);
}
