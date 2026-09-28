/** A browser small enough to run the served scripts in: a cookie jar, a history, a storage, a DOM of plain objects. */

export interface FakeElement {
  tagName: string;
  id: string;
  src: string;
  style: { cssText: string };
  children: FakeElement[];
  parentNode: FakeElement | null;
  textContent: string;
  attributes: Record<string, string>;
  listeners: Record<string, (event: unknown) => void>;
  contentWindow?: { postMessage: (data: unknown, origin: string) => void };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  appendChild: (child: FakeElement) => FakeElement;
  insertBefore: (child: FakeElement, before: FakeElement | null) => FakeElement;
  removeChild: (child: FakeElement) => void;
  addEventListener: (name: string, fn: (event: unknown) => void) => void;
  focus: () => void;
  readonly firstChild: FakeElement | null;
  readonly nextSibling: FakeElement | null;
  [key: string]: unknown;
}

export interface FakeBrowserOptions {
  url: string;
  cookies?: boolean;
  gpc?: boolean;
  storage?: Record<string, string>;
  framed?: boolean;
  fetch?: (url: string, init?: { body?: string }) => Promise<unknown>;
}

export function fakeBrowser(options: FakeBrowserOptions) {
  let href = new URL(options.url);
  const jar = new Map<string, string>();
  const storage = new Map(Object.entries(options.storage ?? {}));
  const beacons: { url: string; body: Record<string, unknown> }[] = [];
  const posted: { data: unknown; origin: string }[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let active: FakeElement | null = null;

  const element = (tagName: string): FakeElement => {
    const el: FakeElement = {
      tagName,
      id: '',
      src: '',
      style: { cssText: '' },
      children: [],
      parentNode: null,
      textContent: '',
      attributes: {},
      listeners: {},
      setAttribute(name: string, value: string) {
        el.attributes[name] = value;
      },
      getAttribute: (name: string) => el.attributes[name] ?? null,
      appendChild(child: FakeElement) {
        child.parentNode = el;
        el.children.push(child);
        return child;
      },
      insertBefore(child: FakeElement, before: FakeElement | null) {
        child.parentNode = el;
        const at = before ? el.children.indexOf(before) : -1;
        if (at < 0) el.children.push(child);
        else el.children.splice(at, 0, child);
        return child;
      },
      removeChild(child: FakeElement) {
        el.children = el.children.filter((c) => c !== child);
        child.parentNode = null;
      },
      addEventListener(name: string, fn: (event: unknown) => void) {
        el.listeners[name] = fn;
      },
      focus() {
        active = el;
      },
      get firstChild() {
        return el.children[0] ?? null;
      },
      get nextSibling() {
        const siblings = el.parentNode?.children ?? [];
        return siblings[siblings.indexOf(el) + 1] ?? null;
      },
    };
    return el;
  };
  const body = element('body');
  const find = (root: FakeElement, test: (el: FakeElement) => boolean): FakeElement[] =>
    root.children.flatMap((child) => [...(test(child) ? [child] : []), ...find(child, test)]);

  const location = {
    get href() {
      return href.toString();
    },
    get protocol() {
      return href.protocol;
    },
    get search() {
      return href.search;
    },
    get pathname() {
      return href.pathname;
    },
    get hash() {
      return href.hash;
    },
  };
  const go = (_state: unknown, _title: string, url: string) => {
    href = new URL(url, href);
  };
  const history = { state: null, pushState: go, replaceState: go };
  const document = {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    },
    set cookie(text: string) {
      if (options.cookies === false) return;
      const [pair, ...attributes] = text.split('; ');
      const [name, value] = pair.split('=');
      if (!value || attributes.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, value);
    },
    body,
    documentElement: body,
    currentScript: null as FakeElement | null,
    get activeElement() {
      return active;
    },
    createElement: element,
    createTextNode: (text: string) => ({ ...element('#text'), textContent: text }),
    getElementById: (id: string) => find(body, (el) => el.id === id)[0] ?? null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => find(body, (el) => el.tagName === selector),
    addEventListener: () => {},
  };
  const window: Record<string, unknown> = {
    crypto,
    addEventListener(name: string, fn: (event: unknown) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)?.add(fn);
    },
    removeEventListener(name: string, fn: (event: unknown) => void) {
      listeners.get(name)?.delete(fn);
    },
  };
  const parent = {
    postMessage: (data: unknown, origin: string) => posted.push({ data, origin }),
  };
  window.parent = options.framed ? parent : window;
  const navigator = {
    globalPrivacyControl: options.gpc === true,
    doNotTrack: null,
    sendBeacon(url: string, text: string) {
      beacons.push({ url, body: JSON.parse(text) });
      return true;
    },
  };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  };

  return {
    window: window as {
      wapTrack: { consent: (ok: boolean) => void; pageview: () => void };
    },
    document,
    history,
    location,
    parent,
    beacons,
    posted,
    storage,
    cookie: (name: string) => jar.get(name),
    element,
    /** The consent banner, when it is on the page. */
    banner: () => document.getElementById('wap-consent'),
    /** Fires a window event: `popstate`, `hashchange`, `message`. */
    dispatch(name: string, event: unknown = {}) {
      for (const fn of [...(listeners.get(name) ?? [])]) fn(event);
    },
    /** A navigation the page did not ask the history for: a hash typed, a back button. */
    moveTo(url: string) {
      href = new URL(url, href);
    },
    /** Lets what the scripts started finish: a turn of the event loop that no fake clock holds back. */
    flush: () =>
      new Promise<void>((resolve) => {
        const { port1, port2 } = new MessageChannel();
        port2.onmessage = () => resolve();
        port1.postMessage(null);
      }),
    /** Runs a served script as a page would; timers fire at once. */
    run(script: string) {
      new Function(
        'window',
        'document',
        'navigator',
        'history',
        'location',
        'localStorage',
        'setTimeout',
        'fetch',
        script,
      )(
        window,
        document,
        navigator,
        history,
        location,
        localStorage,
        (fn: () => void) => fn(),
        options.fetch ?? (() => Promise.resolve({ ok: false, status: 404 })),
      );
    },
  };
}
