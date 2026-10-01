# Silicon Valley Smackdown — Arena Edition

An offline **3D platform fighter** about Silicon Valley egos. Six original fighters, three 3D arenas, local versus, CPU quick matches, an arcade climb to Elon, and training. Made with TypeScript, Three.js and Vite.

**Arena is now the default.** Every Arena fighter is an articulated 3D model, with 3D props, lighting, shadows and animated attacks. Damage percentages increase knockback; ring-outs remove stocks. Fight with double jumps, air control, rising recovery, a three-hit jab string, five directional aerials, projectiles, shields, dodge rolls, real grabs with four throws, pummels and grab-breaking, combos with a live hit counter, coffee and GPU pickups. Each of the six fighters has a genuinely different move set.

The original traditional fighting game remains available as **Classic** at `?classic=1`. Its code, art, save data and Electron packaging remain in the project. See [the archived Classic guide](docs/classic-guide.md).

## Play the ZIP

Extract `Silicon-Valley-Smackdown-Arena.zip`, then open **PLAY.html** in Chrome, Edge or Firefox. No installation, server, Node.js, internet connection, account or ROM is needed. The self-contained browser build includes all six Arena characters, all arenas and synthesized audio. `Source/` contains the editable project.

WebGL 2 with hardware acceleration is required. The ZIP is a portable browser game, not a native `.exe` installer. Choose **Balanced** or **Performance** under *Graphics* in match setup on slower hardware, and turn on **Reduced motion** or turn off **Camera shake** if you prefer a calmer picture. See [the graphics notes](docs/arena-graphics.md).

## Controls

| Action | P1 | P2 | Standard controller |
| --- | --- | --- | --- |
| Move | A / D | Left / Right | Stick / D-pad |
| Jump / double jump | W or Space | Up | A |
| Jab string (tap three times) | V, V, V | J, J, J (or 4) | X, X, X |
| Directional strong attack | Direction + V | Direction + J | Direction + X |
| Aerials (neutral / forward / back / up / down) | V in the air, plus a direction | J in the air, plus a direction | X in the air, plus a direction |
| Signature projectile | B | K or 5 | B |
| Rising recovery | Hold W + tap B | Hold Up + tap K | Up + B |
| Down special (slam, counter or dash, per fighter) | S + B | Down + K | Down + B |
| Shield / dodge roll | N / N + direction | L / L + direction | LT / LT + direction |
| Grab (works from shield) | M | Semicolon or + | Y |
| Throw (while holding) | M + direction (none = forward) | ; + direction | Y + direction |
| Pummel (while holding, twice) | V | J | X |
| Break a grab (first 8 frames) | tap M | tap ; | tap Y |
| Pause | Escape | Escape | Start |

Hold down to fast-fall or drop through an upper platform. Jump twice and use up+special to recover; that works once until you land. Rolls stop at a platform's edge. Coffee heals 22% damage; a GPU increases attack power for eight seconds. First and second detected controllers route to P1 and P2. Menus use mouse/keyboard. F enters fullscreen; O mutes.

**Grabs are real grabs.** M catches first (even out of shield), holds the opponent at your hands, and only damages when you throw. The caught fighter can tap grab in the first 8 frames to break it. Combos count only hits the defender could not act between; the running count shows by your damage. Open **MOVE LIST + COMBOS** on the character-select screen or the pause menu for every move's frame data and each fighter's verified routes. Details, limits and a manual test guide are in [the gameplay notes](docs/arena-gameplay-pass.md).

## Roster and arenas

The original names, palettes and quips remain the source of truth. Hunter throws an iPad, Kevin a briefcase, Al a bottle, Priya résumés, Chad cash, and Elon rockets. Each plays differently: Hunter is a balanced rusher, Kevin a long-reach counter fighter, Al a slow grappler with the longest grab, Priya a fast aerial rushdown, Chad a midrange controller with an armored heavy, and Elon a slow, theatrical artillery fighter. They fight on **Castro Street**, **Sand Hill Road**, and **Palo Alto Launch Night**.

Arena uses original code-authored models with jointed arms/legs, heads, faces, clothing and accessories. It follows the platform-fighter direction of [JRickey/BattleShip](https://github.com/JRickey/BattleShip), without using BattleShip code or Nintendo/ROM assets. The legacy Maul guest is available only in Classic/source; the portable Arena game uses the six Silicon Valley characters.

## Edit and build

Node.js 22.12+:

```sh
npm ci
npm run dev
```

| Command | Result |
| --- | --- |
| `npm test` | Classic and Arena simulation/unit tests |
| `npm run build` | Type check and production web build in `dist/` |
| `npm run build:portable` | Self-contained `release/Silicon-Valley-Smackdown-Arena/PLAY.html` |
| `npm run package:zip` | Playable ZIP plus editable source; finds a working Python 3 itself (`python3`, `python` or `py -3`) |
| `npm run test:arena` | Arena browser checks against the production build |
| `npm run test:e2e` | Existing Classic browser suite |
| `npm run desktop` | Existing Electron desktop development launcher, now opening Arena |
| `npm run dist:win` | Existing native Windows packaging workflow |

For browser tests, install a Playwright Chromium browser with `npx playwright install chromium`. Set `SVS_CHROMIUM` to use an existing executable. `SVS_PORTABLE=1 npm run test:arena` tests the built file directly. Hardware-restricted CI can set `SVS_SANDBOX_DEVICES=1` to use synthetic device state.

See [Arena implementation notes](docs/arena-edition.md) for module responsibilities, mechanics, packaging and practical limits, [the graphics notes](docs/arena-graphics.md) for the rendering pass (flicker fix, lighting, presets, measurements), and [the gameplay notes](docs/arena-gameplay-pass.md) for the fixes, character differences, tested combos and a manual test guide. `src/arena/Simulation.ts` is deterministic and independent of the browser/renderer. Platform data in `data.ts` drives collision, ledges and the visible stage. Classic's original simulation stays separate.
