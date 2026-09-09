# 🚜 Farm Life 3D

A browser farming game. Plant and harvest crops, raise cows, chickens and
sheep, and sell what you produce at the market to expand the farm — until you
can afford a country house, or hold out for the villa.

Play it at **https://giorgijv.github.io/farm-life-3d/**

## About this fork

This started as a copy of [Farm Life](https://giorgijv.github.io/farm-game/)
([source](https://github.com/giorgijv/farm-game)) and was rebuilt around a 3D
farm: a farmer you steer to the work, animals in a pen she crosses the yard to
milk, seasons and weather over the top, and the day/night cycle driving real
light.

Everything below describes the game as it plays today. The 3D work is layered on
top of these rules rather than replacing them — the simulation, the economy and
the save format are shared with the original.

**What's 3D:** the field is a 3D yard, and you drive the farmer around it —
an on-screen stick under your thumb, or the arrow keys or WASD. Walk up to
something and the game offers what it is for ("Plant 🌾 Wheat", "Harvest",
"Collect 🥛"); press that button, or the space bar, and she does it. Clearing
a ripe field is a round she walks rather than four instant taps.

Beside the field is a fenced pen with the herd in it — animated cows,
chickens, sheep, a dog and a cat, each wandering its own lane, a guardian on
duty trotting the fence line while a hungry one waits it out. The crops are
modelled too, and change shape as they grow rather than just colour. There is
a pond whose water actually moves, an orchard that turns to autumn colour and
back, grass that disappears under winter, and rain that builds in across the
three days before a hurricane lands, greying the sky as it comes. The sun
tracks the same clock the 2D sky strip reads, carrying the yard from daylight
through a warm dusk into a moonlit night. The camera follows her and is yours
to move — drag to orbit, pinch to zoom, two fingers to pan, clamped so it
can't go underground or flip upside down.

None of that is required to play. The whole game is still reachable from the
keyboard alone, and from a screen reader — see [Accessibility](#accessibility).

### Its save is its own

Both games are served from `giorgijv.github.io`, and `localStorage` is scoped to
the **origin**, not the path — so a shared save key would mean the two farms
silently overwriting one another. This game stores under `farmLife3dSave_v1` and
its legacy list deliberately contains none of the 2D game's keys. Playing one
cannot touch the other.

## Play

It's a static site with no build step. Either open `index.html` directly in a
browser, or serve the folder:

```bash
npm run serve     # http://localhost:4173
```

The **❓ button** in the top bar opens a full rundown of every system in the
game. It is generated from the same constants the game runs on, so the rules on
screen can never drift from the rules being enforced.

## How it works

- **Difficulty** — three tiers, chosen on the first screen and changeable any
  time under Market → Difficulty:

  | | Prices | Spoil/hunger clocks | Raids | Subsidy | Start |
  |---|---|---|---|---|---|
  | 🌻 **Relaxed** | +25% | ×2 | rarer | 150 | 200 |
  | 🚜 **Farmer** | standard | standard | standard | 100 | 100 |
  | 🌪️ **Hard** | −20% | ×0.5 | ~2× as often | 50 | 50 |

  Both dream homes cost 20,000 and 40,000 on every tier, so the difficulty
  shows up as how long the run takes rather than as a different finish line.
  The in-game guide always quotes the numbers your current tier is enforcing.

- **The farmer** — the first thing a new game asks is who is running the place:
  a female or male farmer. They do every job here, and they eat too. A meal of
  **2 pumpkins** keeps them going for three in-game days.
  Going hungry happens in two steps. First they are **exhausted**: every
  harvest is halved, and the bar switches from energy to a countdown. Keep
  working through that without eating for four more in-game days and they
  **collapse — that is game over**, with the run summed up and the option to
  start a new farm or load a save. A tired harvest never yields nothing, so
  the way out stays open right up to the last moment. The choice of farmer can
  be changed later under Market → Farmer. The game refers to your farmer by the
  gender you picked — he/him or she/her.
- **Farm** — pick a seed (wheat, corn, carrot or pumpkin), walk her to an empty
  plot and take the prompt. Crops grow through seed → sprout → ripe; walk her
  back to a ripe one and the prompt offers to harvest it. Eight of the sixteen
  plots start locked and are bought one at a time with coins.
- **Spoilage** — a ripe crop keeps for two in-game days. The plot's bar
  switches from growth to shelf life the moment it ripens, turning red with an
  hourglass for the last third of the window; leave it past that and the crop
  rots and has to be cleared for nothing. The countdown only runs while the
  game is open, so closing the tab never costs a harvest — crops that ripen
  while you are away are still waiting when you come back.
- **Animals** — buy cows, chickens and sheep. Each eats its own food, and the
  bill scales with what it produces: a chicken cycle costs 3 coins of wheat
  and returns 5, a cow costs 12 of corn and returns 18, a sheep costs 20 of
  carrot and returns 28. Feed one to start production, then collect milk,
  eggs or wool when the timer finishes. Animals can be sold back for half
  their base price — selling asks for confirmation first, since the Sell
  button sits under Feed and buying a replacement costs more than the refund.
- **Hunger** — an animal left hungry for four in-game days starves and is
  gone. Its bar counts down to that instead of up to produce, and the card
  turns red with a pulsing **Starving!** and a one-off warning for the final
  day. Selling a starving animal still recovers half its price, and — as with
  crops — the clock only runs while the game is open, so nothing dies while
  you are away.
- **Guardians** — a **dog** chases off the wolves that otherwise carry away
  livestock, and a **cat** (fed on milk) keeps crows from eating planted
  crops. A dog will not touch produce: feeding one means **slaughtering an
  animal**, and the bigger the animal the longer the watch — a chicken buys
  90 seconds, a sheep 200, a cow 320. Giving up a cow or a sheep asks for
  confirmation; a chicken, the intended staple, does not. Both guardians
  protect only while fed: one works a shift, then goes hungry and needs
  feeding again. Each one on duty covers
  **four** of its charges, so the guard has to grow with the farm — a dozen
  animals need three dogs, a full sixteen-plot field needs four cats. Cover
  only part of the farm and you turn away only that share of raids, so a lone
  dog watching eight animals is in the right place half the time. The Animals
  tab shows the coverage and warns when it falls short. Raids are infrequent
  and jittered, and any that fall due while the game is closed are skipped
  rather than resolved, so a farm is never wiped out overnight.
  Raids are played out rather than merely reported: crows sweep in over the
  field, a wolf comes in low at the pens, and a guardian on duty charges in and
  drives them off in front of you. Whatever was taken flashes where it stood.
  The attacker aims at the real tile or card when you are on that tab and
  crosses mid-screen when you are not, so a raid is never invisible. All of it
  is skipped under `prefers-reduced-motion`, which still leaves the message.
- **Subsidy** — a farm starts with **100 coins**, and every seven in-game days
  it keeps going the state pays a **government subsidy of 100 coins** (the
  first on day 8). Those are days *played*, not days on the wall clock, so the
  subsidy has to be earned at the wheel — you cannot leave the tab shut for a
  month and come back to a fortune. It is deliberately a trickle next to what a
  worked field earns: enough to stop a struggling farm stalling out, nowhere
  near enough to make farming optional.
- **Hurricanes** — every **8 weeks** a hurricane crosses the farm: the first on
  day 57, then every 56 days. **Every crop in the ground is flattened** and
  nothing protects a field — no barn, no upgrade, no guardian. What a **barn**
  saves is the herd, and the larger one your stores as well:

  | | Animals | Harvested goods | Price |
  |---|---|---|---|
  | 🛖 **Small Barn** | 10 sheltered | ✗ blow away | 10,000💰 |
  | 🏘️ **Large Barn** | 30 sheltered | ✓ kept | 30,000💰 |

  With no barn you lose the herd and everything in your stores. Owning the
  small one counts towards the large, so upgrading costs only the 20,000
  difference. Animals that do not fit are lost, dearest sheltered first. The
  Market shows a forecast counting down to the next storm and warns three days
  out.

  **Coins are the one thing a storm can never take**, so there is always money
  for seed and never a dead end — and every hurricane day happens to be a
  subsidy day too, since 56 divides by seven, so the relief cheque arrives with
  the wind.

  **The economics, honestly:** a thirty-animal herd costs a little under 9,000
  to replace, so on livestock alone the 30,000 Large Barn does not pay for
  itself until the fourth storm. What tips it is the loft — a full store of
  unsold produce is worth hundreds by itself, and not having to clear it out
  before every storm is worth more again. The 10,000 Small Barn is half a
  Country House and buys you only the animals. The free defence is still to
  sell everything and empty the field before the day arrives; a barn is what
  you buy to stop having to.
- **Market** — sell produce for coins, review your holdings, adjust sound, and
  export or import your save. It also sells four permanent **upgrades** —
  faster crops, faster animals, larger harvests and better prices — each with
  three increasingly expensive levels, so late-game coins always have
  somewhere to go.
- **Awards** — eleven achievements covering harvesting, livestock, expansion
  and wealth, each paying a one-off coin reward.
- **Dream** — the two grand goals everything else builds towards: a **Country
  House** for 20,000 coins or a **Grand Villa** for 40,000. They are strictly
  either/or — buying one takes the other off the market for good, so the run
  ends on a choice between cashing out early and holding out for twice the
  price. Both cards show live progress towards their price, and the purchase
  asks for confirmation because it cannot be undone. Buying one rolls the
  ending: your new home from the inside — a beamed cottage or a marble villa —
  with fireworks over the fields through the window and the run summed up. It
  can be replayed any time from the owned card.

Sound effects and the background music loop are synthesised with the Web Audio
API — there are no audio files. Music, volume and a master mute live under
Market → Sound.

A full day passes every 90 seconds **of play**, carrying the sky from daylight
through a warm dusk to a starlit night. The calendar is banked a tick at a time
while the game is open and stops dead when it is closed, so days — and the
weekly subsidy that rides on them — are something you play through rather than
wait out.

Crops and animals are the exception, and deliberately so: they run on real
timestamps and keep growing while the tab is closed, so coming back after a
while still greets you with a summary of what ripened. Everything that costs
you (spoilage, hunger, starvation, raids) and everything that pays you (the
calendar, the subsidy) is measured in play time instead.

Progress saves automatically to `localStorage`. Because that is per-browser,
the Market tab also offers **Download Save** / **Load Save** to back progress
up or move it between devices.

**Market → Start Over** clears the farm and begins again with nothing but the
opening purse, keeping the difficulty tier you were playing. It sits at the
bottom of the tab, styled apart from the routine controls, and the confirmation
lists exactly what is about to be lost — day, coins, plots, awards and any
dream home — because there is no undo.

## On a phone

The game is built to be played on a phone. Open the link in Chrome on Android
and use **Add to Home screen** — the manifest and service worker make it launch
full-screen and run with no network connection. (As usual for service workers,
the first visit loads from the network and the offline cache takes effect from
the next load onwards.)

Every control is sized to Material's 48dp touch target. Turned to landscape the
3D scene gives up height rather than pushing the tabs off the bottom of the
screen, and the driving stick and the action prompt both stay where a thumb can
reach them. Hover effects are suppressed on touch so they cannot stick after a
tap, and padding respects display cutouts and the gesture bar when running
full-screen.

## Accessibility

Driving a character around a field is no use to a player who cannot see it, so
the game keeps two complete ways to play and neither is a lesser one.

Every control is a real button, and the sixteen plots are a real grid of them
with descriptive labels ("Plot 3, Wheat ready to harvest"). The grid takes
**one tab stop, not sixteen**: the arrow keys move between plots while it has
focus, Home and End jump to the ends, and Enter or Space sends her to the plot
you are on. Away from the grid those same arrows drive her, so they always
mean "move whatever I am paying attention to". Which plot the keyboard is on is
drawn in the scene itself, on the tile where it actually is, rather than as a
flat marker over the canvas.

Because the game is played by walking, what is **within reach** is announced
through a polite live region as it changes — otherwise the prompt button's text
would change silently to anyone not looking at it, which is exactly what free
movement broke and what this puts back. Growth and production are exposed as
progress bars, toasts are announced, and animation is disabled under
`prefers-reduced-motion`.

## Development

Everything is hand-written HTML, CSS and JavaScript — no framework, no build
step, and no external assets. All artwork is CSS-generated, so the game works
offline once loaded.

- `index.html` — markup and the scenery layers
- `styles.css` — the whole visual system
- `script.js` — game state, systems, rendering and audio
- `scene.js` — the 3D farm scene (three.js), talking to `script.js` through
  `window.Farm3DBridge`
- `assets.js` — loads the 3D models, and normalises them to a world scale
- `assets/` — the models themselves (CC0, from Kenney), and a manifest the
  service worker precaches from
- `vendor/` — three.js itself, kept local so the game stays offline and
  dependency-free
- `tools/vendor.mjs` — fetches everything in `vendor/` and `assets/`; run it
  rather than editing those by hand
- `sw.js` / `manifest.webmanifest` — offline caching and installability
- `tests/` — Playwright end-to-end suite

### Tests

```bash
npm install
npx playwright install chromium   # first run only
npm test
```

`tests/game.spec.js` covers the core loop, the farmer and their meals, animal
production, guardians and raids, guard coverage scaling with the farm, feeding
a dog on livestock, crop spoilage, animal starvation, the market, upgrades,
achievements, the two dream homes, hurricanes and barns, the weekly subsidy, the difficulty
tiers, the day cycle, save loading/migration, the
welcome-back summary, the help panel, the farmer's collapse and game over,
the ending celebration, keyboard operability, and offline play. It also asserts that the
once-a-second render reuses DOM nodes, since rebuilding them would silently
restart every CSS animation.

The 3D half is tested by asking the scene questions rather than by looking at
pixels: that the pond's water is moving rather than painted, which crop model
a plot is actually showing, where a roaming animal really is, that the season
turns the orchard and hides the grass, that rain thickens as a hurricane
nears, and that a keyboard-only player can plant and harvest without touching
the plot grid at all. There is also a **draw budget** — the worst state the
game can reach must stay inside a stated ceiling of draw calls and triangles,
and a farm behind another tab must draw nothing whatever, which is the
difference between a phone spending its battery on a scene nobody is looking
at and not.

`tests/mobile.spec.js` runs the game at phone sizes — 360px, 393px and
landscape — checking that nothing scrolls sideways, that no control falls below
the 44px touch floor, that the scene shrinks rather than shunting the tab bar
off screen in landscape, and that the whole loop can be played by touch alone:
driving her there with the stick and taking the prompt when she arrives.

If you are running in a sandbox that already ships a Chromium whose build
number does not match this Playwright version, point the tests at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

CI runs the same suite on every push and pull request.

### Play-testing

`tools/playtest.js` drives the real UI on every difficulty and checks the save
after every action. Two phases: a real-time bot that plants, harvests, feeds,
buys and sells, and a stress phase that forces the events a short run cannot
reach — the weekly subsidy, spoilage, starvation, raids with and without a
guardian, the farmer's collapse, the ending, and a tier switch on top of each.

```bash
npm run playtest              # 60s x 2 runs per tier, then the stress phase
node tools/playtest.js 120 3  # longer runs, more of them
```

Every scenario asserts what it expected to happen, not merely that nothing
threw: a structural check alone will happily pass a subsidy that quietly
forgets to record itself. The harness is verified by injecting known faults and
confirming it reports them.

It also holds one invariant about **itself**. A fuzzer that has quietly stopped
reaching the game finds no problems either, which looks exactly like good news
— and that is not hypothetical: the bot spent several rounds of work clicking a
plot grid that had stopped taking pointer input, planting nothing and reporting
a clean bill of health every time. So a run that ends without a single crop in
the ground now says so instead of printing a row of zeroes nobody reads.
