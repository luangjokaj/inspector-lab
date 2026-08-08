/**
 * Parcel's `bundle-text:` scheme: builds the target as its own bundle and
 * inlines the result as a string. ~lib/page-bridge-client uses it to carry the
 * page bridge's source inside the inspector bundle, which is the only way a
 * content script can reach it — an injected content script cannot resolve
 * `url:` bundle addresses at runtime.
 */
declare module "bundle-text:*" {
  const source: string;
  export default source;
}
