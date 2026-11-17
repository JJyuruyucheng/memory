# Third-party notices

## Embla Carousel

The login photo carousel uses [Embla Carousel 8.6.0](https://github.com/davidjerleke/embla-carousel/tree/v8.6.0) under the MIT license. Its original UMD bundle is vendored locally without modification. [The license](public/assets/EMBLA-LICENSE.txt) and [the archive integrity and file checksums](vendor/embla.lock.json) are preserved. No remote CDN is required at runtime.

## Supabase JavaScript SDK

The free hosting provider uses the official [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) 2.119.0 browser bundle under the MIT license. The original bundle is vendored without modification; [the license](vendor/SUPABASE-LICENSE) and [the version, archive integrity and bundle checksum](vendor/supabase.lock.json) are preserved. The Supabase build ships the license beside the bundle. No CDN executes third-party SDK updates at runtime.

## Uiverse / Galaxy — primary-button icon interaction

Author: alexmaracinaru (Alex Maracinaru)

Component: https://uiverse.io/alexmaracinaru/brown-bobcat-65

Archived source: https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/alexmaracinaru_brown-bobcat-65.html

Repository license: https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/LICENSE

Portion used: icon translation on hover and pressed feedback, adapted in `src/components.css`. The original full button design and SVG artwork are not included. The reaction-button state styling is original project code.

The component page displays the creator copyright below; the official archive also carries the Uiverse.io copyright. Both are preserved here and in the shipped CSS.

```text
MIT License

Copyright - 2026 alexmaracinaru (Alex Maracinaru)
Copyright (c) 2023 Uiverse.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Memos

The project targets a separately deployed [Memos](https://github.com/usememos/memos) backend maintained by the Memos community. Its source and release artifacts retain their own [MIT license and copyright notices](https://github.com/usememos/memos/blob/main/LICENSE). This frontend's license does not replace upstream licensing, and this notice does not imply an official affiliation.

## Other resource sites

[11xy.cn](https://www.11xy.cn/) and [雷盒](https://leibox.pantoria.cn/) were supplied as component resources. No code or media was extracted from them in this implementation because specific source code and licensing could not be verified during access. See [component-sources.md](docs/component-sources.md).
