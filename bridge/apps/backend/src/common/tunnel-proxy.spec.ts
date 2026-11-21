import {
  preferTunnel,
  setTunnelProxy,
  STACK_PROXY_URL,
  tunnelProxyUrl,
} from './tunnel-proxy';

describe('preferTunnel', () => {
  afterEach(() => setTunnelProxy(null));

  it('replaces the stack client by the bridge tunnel while it works', () => {
    setTunnelProxy('http://127.0.0.1:18081');

    expect(tunnelProxyUrl()).toBe('http://127.0.0.1:18081');
    expect(preferTunnel(STACK_PROXY_URL)).toBe('http://127.0.0.1:18081');
    expect(preferTunnel(`${STACK_PROXY_URL}/`)).toBe('http://127.0.0.1:18081');
  });

  it('keeps a proxy the owner chose, and goes direct when there was none', () => {
    setTunnelProxy('http://127.0.0.1:18081');

    expect(preferTunnel('http://my-proxy.example:3128')).toBe(
      'http://my-proxy.example:3128',
    );
    expect(preferTunnel(undefined)).toBeUndefined();
  });

  it('keeps the configured proxy when the tunnel is not working', () => {
    expect(tunnelProxyUrl()).toBeUndefined();
    expect(preferTunnel(STACK_PROXY_URL)).toBe(STACK_PROXY_URL);
  });
});
