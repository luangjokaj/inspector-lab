# What is Inspector Lab - DevTools, and why I built it

Inspector Lab - DevTools is a Chrome extension that puts a full developer-tools window directly on the page you are looking at. Elements tree, live styles, forced states, console with evaluation, network requests with headers and response bodies, sources, cookies, storage. It floats or docks, it survives reloads, and it looks and behaves the way DevTools always has, because your muscle memory is worth keeping.

That description raises an obvious question: browsers already ship devtools, so why build one as an extension?

## The way we work changed

Most of my code is not typed by me anymore. Agents write it. My job increasingly is orchestration and supervision: describing what should exist, reviewing what came back, and verifying it actually works. That last part, verification, still needs real tools. You open the app, you poke at the DOM, you watch a request fire, you check what landed in a cookie.

Once your work becomes supervising rather than typing, where you sit stops mattering. Like a lot of developers, I moved my environment onto a remote machine. The code lives on a VPS, the agents run there, and I connect from whatever is in front of me. Often that is an iPad on a couch, in a train, wherever. Remote development from a tablet is not a gimmick anymore; it is genuinely how I ship.

And that is where the tooling breaks down.

## The tablet browser has no F12

On a laptop, verifying an agent's work is trivial: open the page, hit F12. On an iPad there is no F12. iPadOS browsers do not ship developer tools, and Apple's rules mean you cannot get desktop Chrome's inspector there at all. You can see your app, but you cannot look inside it.

What iPadOS does have, thanks to one browser in particular, is extensions. [Orion by Kagi](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html) runs Chrome (and Firefox) web extensions on iOS and iPadOS. Support is officially still maturing and not every extension API exists there, but it is real, and it is the only game in town on an iPad.

So the answer became obvious: if the browser will not give me devtools, but it will run an extension, then the devtools should _be_ an extension. Everything Inspector Lab does happens through content scripts and standard extension APIs on the page itself. No debugger protocol, no desktop-only surfaces. If a browser can run the extension, you get an inspector, pointer-friendly and resizable, on the device you are actually holding.

## The wider landscape

Orion is the reason this project exists, but it is not entirely alone:

- **Orion (iOS / iPadOS)**: runs Chrome and Firefox extensions natively. The primary target for Inspector Lab away from the desktop.
- **Firefox for Android**: has an [official add-ons catalog](https://alternativeto.net/news/2023/8/mozilla-to-reintroduce-full-browser-extension-support-for-firefox-android-app) again since late 2023. Firefox extensions rather than Chrome ones, so a port would be needed, but the door is open.
- **Microsoft Edge for Android**: ships an [extension store](https://www.howtogeek.com/microsoft-edge-on-android-has-extensions-now/), having absorbed the extension support from Kiwi Browser when [Kiwi was discontinued in early 2025](https://www.neowin.net/news/kiwi-browser-takes-final-breath-but-at-least-some-of-it-will-live-on-in-microsoft-edge/). The catalog is curated and still small.
- **Desktop Chrome and every Chromium browser**: runs it today, and it is surprisingly pleasant there too. A movable inspector that lives inside the viewport, remembers its panel per site, and comes back after every reload is useful even when F12 exists.

Chrome itself supports no extensions on iPad or Android, which still surprises people.

## What it is not

Inspector Lab does not pretend to replace the full DevTools application. Some things genuinely require the debugger protocol: breakpoints, CPU profiles, bypassing a page's CSP. The [feature tour](FEATURES.md) is honest about every boundary. The goal is different: the twenty inspections you actually do all day, on any machine that can run a browser extension, two taps from the page you are supervising.

Built by a developer who reviews more code than he writes now, for everyone working the same way.

[Luan](https://github.com/luangjokaj) · [MIT](https://choosealicense.com/licenses/mit/)
