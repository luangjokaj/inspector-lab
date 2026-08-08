/**
 * Compatibility layer for non-HTML host documents — a standalone SVG opened
 * directly in a tab, most importantly.
 *
 * In an XML document, document.createElement() creates elements in the *null*
 * namespace: they are not HTMLElements, have no `.style`, cannot attachShadow,
 * and never render. Everything the inspector builds — including every element
 * React and styled-components create on its behalf — goes through
 * document.createElement, so on such documents the call is redirected to
 * createElementNS with the XHTML namespace. The patch lands on this isolated
 * world's wrapper of the document, so page scripts never see it.
 *
 * This module must stay the first import of the injected entry, ahead of
 * anything that might create elements.
 */

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/**
 * The `<foreignObject>` the inspector renders into on SVG documents. Defined
 * here — the import-nothing module — so the head shim below can find it
 * without pulling the rest of the inspector in; inspector-dom re-exports it
 * for everyone else.
 */
export const FOREIGN_LAYER_ID = "inspector-lab-extension-layer";

/**
 * True when document.createElement natively produces HTML-namespace elements,
 * i.e. this is an ordinary HTML or XHTML document. Not derivable from
 * `instanceof HTMLDocument` — browsers alias HTMLDocument to Document, so
 * that test passes on XML documents too.
 */
export const isHtmlDom: boolean = (() => {
  try {
    return document.createElement("div").namespaceURI === HTML_NAMESPACE;
  } catch {
    return false;
  }
})();

if (!isHtmlDom) {
  document.createElement = ((
    tagName: string,
    options?: ElementCreationOptions,
  ) =>
    document.createElementNS(
      HTML_NAMESPACE,
      // XML createElement would have preserved case; HTML tag names are
      // lowercase, and that is what every caller here means.
      tagName.toLowerCase(),
      options,
    )) as typeof document.createElement;

  /**
   * Libraries dereference document.head without a guard — styled-components'
   * CSP-nonce probe (`document.head.querySelector('meta…')`) is what took the
   * inspector down on SVG pages, and Cherry's theme-color sync appends there
   * too. XML documents have no head, so this world gets one: the inspector's
   * overlay layer once bootstrap has built it — connected to the document, so
   * appended scripts (the page bridge) and styles still take effect — and a
   * detached stand-in before then, which still satisfies every querySelector.
   */
  const detachedHead = document.createElementNS(HTML_NAMESPACE, "head");
  Object.defineProperty(document, "head", {
    configurable: true,
    get: () => document.getElementById(FOREIGN_LAYER_ID) ?? detachedHead,
  });
}
