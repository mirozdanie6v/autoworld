# AutoWorld AWG — адаптивность и ширина десктопа
Дата: 15.10.2026. Сайт: https://awgcars.ru/. Контур: публичный Web, Telegram Mini App, VK Mini App (общий index.html).

## Метод
Read-only браузерный аудит публичной страницы в 10 ширинах: 1920, 1600, 1440, 1366, 1280, 1024, 768, 430, 390, 320 px. Измерены window.innerWidth, documentElement.scrollWidth, координаты `.auto-shell`, `.auto-main`, `.auto-bottom`, горизонтальное переполнение. Затем CSS-кандидат временно применён только в браузере (не на сервере) и проверен при 1920, 1600, 1440, 1366, 1280, 1100, 1024, 900, 768, 430, 390, 320 px.

## Подтверждённая первопричина
Базовый `public/auto-sale.css` ограничивал `.auto-shell` значением `max-width:1180px` и центрировал через `margin:0 auto`. При ширине 1920px были пустые поля примерно по 362.5px, при 1440px — по 122.5px. Это не баг JS или API Gateway. Отдельные ~15px справа занимает стандартный вертикальный scrollbar браузера, который нельзя просто выключать.

| viewport | До: shell / client | После временного CSS: shell / client | horizontal overflow |
|---|---|---|---|
| 1920 | 1180 / 1905 | 1901 / 1901 | нет |
| 1600 | 1180 / 1585 | 1581 / 1581 | нет |
| 1440 | 1180 / 1425 | 1421 / 1421 | нет |
| 1366 | 1180 / 1351 | 1347 / 1347 | нет |
| 1280 | 1180 / 1265 | 1261 / 1261 | нет |
| 1100 | — | 1081 / 1081 | нет |
| 1024 | 1009 / 1009 | 1005 / 1005 | нет |
| 900 | — | 881 / 881 | нет |
| 768 | 753 / 753 | 749 / 749 | нет |
| 430 | 415 / 415 | 411 / 411 | нет |
| 390 | 375 / 375 | 371 / 371 | нет |
| 320 | 305 / 305 | 301 / 301 | нет |

Показатели clientWidth отличаются из-за оформления системного scrollbar и среды тестового браузера — сравнивать нужно относительную ширину shell/client, а не строго одинаковые пиксели.

## Исправление
- Новый `public/auto-sale-desktop-fluid.css` загружается последним и только при desktop `min-width:1025px` снимает предел 1180px: `width:100%;max-width:none;margin-inline:0`; внутренние поля `clamp(20px,2.5vw,56px)`.
- `.auto-grid` на широком экране использует auto-fit с минимальными 300px; на 1920px стало пять колонок, на 1440–1600px четыре, на 1280px три. Ни один элемент карточек не вышел за viewport в публичном тесте.
- Вертикальный scrollbar оставлен доступным, track окрашен под тёмный фон и thumb синий графит.
- Существующая адаптивность планшетов и телефонов до 1024px, нижняя панель и safe-area не изменяются.

## Остаточные риски и границы
- Проверка публичного экрана не равна полноценному UI-тесту приватных CRM-состояний для менеджеров/директора: для них потребуются авторизованные browser-smoke с тестовыми ролями без реальных сделок.
- На 320px проверка с временными стилями обнаружила один потенциально выступающий SPAN. Нужен отдельный адресный UI-аудит его содержимого: горизонтального скролла и выхода основных карточек за экран не обнаружено.
- Если правая полоса — это native scrollbar браузера, он будет физически занимать небольшой участок экрана; скрытие скролла не применяется из соображений доступности.
- Полностью исключить горизонтальное переполнение в скрытых формах/модальных окнах только публичным аудитом нельзя.

## Защита production
Выпуск **только статических** `index.html` + `auto-sale-desktop-fluid.css` в прежний Yandex Object Storage. Перед изменением бэкап текущего index.html; после — HTTP-smoke, проверка неизменности `/api/health` build SHA и VK/Telegram; rollback index при ошибке. YDB, Telegram webhook/relay, API Gateway, контейнер, секреты и клиентские данные не изменяются.


## Production verification after CSS release

- `main` PR [#44](https://github.com/mirozdanie6v/autoworld/pull/44) merged; static-only production [GitHub Actions #38702960143](https://github.com/mirozdanie6v/autoworld/actions/runs/38702960143) PASS.
- Fresh browser session with **no inline stylesheet overrides** confirmed `auto-sale-desktop-fluid.css?v=20261015-fluid-v1` loaded and its CSS rule active.
- On production: 1920px viewport: clientWidth = shellWidth = **1910px**, mainWidth = **1814px**; 1440px: clientWidth = shellWidth = **1430px**, mainWidth = **1358px**; 1366px: **1356px**; 1280px: **1270px**.
- For 1024/768/430/390/320px, the shell stays at full browser client width with existing responsive layouts, no horizontal overflow; public catalog clippedCards = 0 at every tested viewport.
- At 1920px the live catalog currently has only three rendered cards, so its `auto-fit` naturally renders **3** columns even though the same CSS accommodates more columns if additional cards are present; this is expected.
- Existing translucent scroll-to-top button remains in DOM.
- Native vertical scrollbar remains accessible and occupies ~10px on the desktop test browser; it blends into the dark theme rather than becoming a bright strip.
- Automated and browser checks do not replace authorized manager/owner CRM forms and mobile overlay audits; those require test-role sessions.
