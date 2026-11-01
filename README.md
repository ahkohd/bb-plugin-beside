# Beside

An inbox for your bb threads. Threads stay in the order you started them, and
work you have dealt with moves to a shelf until it has news.

![Beside in the bb sidebar](docs/overview.png)

## Install

```sh
bb plugin install git:https://github.com/ahkohd/bb-plugin-beside.git
```

Then choose Beside in Settings, Appearance, Sidebar. bb's own list comes back
if you switch away or disable the plugin.

Beside needs bb 0.46 or later.

## How it works

The sidebar has five shelves:

- Pinned: your pinned threads, in the order you drag them into.
- Inbox: everything else, newest first. A row never moves because an agent
  finished something; its status shows at the end of the row instead.
- Snoozed: hidden until the time you picked.
- Settled: work you are done with.
- Muted: threads you never want back in the Inbox, but do not want to archive.

A snoozed or settled thread comes back to the Inbox when it finishes, fails or
asks you something. A muted thread stays muted until you unmute it; if it asks
you something, the Muted header shows bb's question glyph.

You cannot park a thread that is waiting for your answer, because hiding the
question would leave the agent stuck. A running thread can be parked.

Child threads sit under their parent and move with it. A collapsed parent shows
the most urgent status among its children.

## Everyday use

Hover a row to snooze it until tomorrow, settle it, or open bb's thread menu.

![Settling and snoozing threads](docs/park.gif)

Open a parent to see its children.

![Opening a parent's child threads](docs/children.gif)

Drag a pinned thread to reorder it. The order is saved in bb, so bb's own list
shows it too.

![Reordering pinned threads](docs/pins.gif)

## Menus

Each shelf header has a menu, shown on hover. Bulk actions offer Undo.

| Shelf   | Menu                                         |
| ------- | -------------------------------------------- |
| Inbox   | Settle all, Snooze all, Settle after reading |
| Snoozed | Wake all                                     |
| Settled | Archive all, Move all to Inbox, Auto-archive |
| Muted   | Unmute all, Archive all                      |

Bulk actions apply to what the shelf shows, so the project filter and search
count. Threads waiting for your answer are skipped.

Settle after reading settles a thread when you move on to another thread, if
you have read it and it is idle. A background command, such as a dev server,
does not stop it. Moving between a parent and its children does
not count as moving on. It only applies to threads you read after switching it
on.

Auto-archive archives threads that have stayed settled for 1, 3, 7, 14 or 30
days with no news. It is set to Never by default. It runs on the bb server once
an hour and skips pinned threads and threads that are running or waiting for
you.

![Shelf menus and Auto-archive](docs/shelves.png)

## Decision mode

Decision mode asks a decision model whether news on a snoozed or settled thread
needs you. When an agent finishes a turn on a parked thread, Beside sends the
thread's title and the agent's last message to the model. If the message only
reports routine work, the thread stays on its shelf with bb's unread dot, and
the shelf header shows a dot too.

<img src="docs/decision-sidebar.png" alt="Two settled threads with routine news stay on the Settled shelf with a dot; two threads that need you are back in the Inbox" width="290">

Anything else comes back to the Inbox as before: a question, a failure, a
message that asks you something or is worth reading now, and any answer the
model is unsure about. If the model cannot be reached, times out or answers
something unexpected, the thread comes back too.

Decision mode is off by default. To turn it on, open Settings, Plugins, Beside.
Under Decision mode, Setup, choose a model:

- TypeSafe Jev: TypeSafe's hosted model. Paste your TypeSafe API key. Your
  agents' last messages are then sent to TypeSafe.
- Custom: any System One decision API. We recommend self-hosted d3-flash;
  Liquid d1 is a smaller alternative. Enter the endpoint and its model name.
  The API key is optional if your endpoint does not require one.

Each model keeps its own key. Keys are stored on the bb server in a file only
the server can read, and are never sent back to the browser. Check connection
sends one test message and shows which model answered and how long it took.

### Use a self-hosted model

We recommend [d3-flash](https://huggingface.co/vllm-sr/d3-flash), a 9B-class
multimodal decision model, so your agents' messages stay on your own machines.
Beside uses its text decisions through the same `/v1/systemone` API; it does
not send images or videos. Its BF16 weights are about 16.8 GB, plus runtime memory.

Install a GPU-compatible PyTorch and torchvision build in a Python virtual
environment first. Download the model package, including its custom Python
runtime, and review the code before running it. This example pins the model
revision:

```sh
pip install huggingface_hub
hf download vllm-sr/d3-flash --revision 13dc1cc8ef23caefa765907e1d764751e5629f7d --local-dir ./d3-flash
pip install -r d3-flash/requirements.txt
python d3-flash/d3_server.py --model ./d3-flash --device cuda:0 --batch-size 1 --host 127.0.0.1 --port 30002
```

Choose Custom, enter `localhost:30002` and model name `d3-flash`. Leave the
key empty only if your server does not require one. Do not use the ordinary
chat-completions endpoint.

The endpoint must be reachable from the machine that runs the bb server,
not just your browser or an agent's box. If the model runs elsewhere, use a
private proxy or tunnel and enter its reachable URL, including any HTTPS
port. A host-only URL gets `/v1/systemone` added automatically. The package
server supports a bearer key through `DECISION_API_KEY`; an unauthenticated
endpoint should stay limited to trusted callers.

#### Smaller alternative: Liquid d1

[Liquid d1](https://huggingface.co/LiquidAI/d1-3B-GGUF) remains supported.
It is a smaller 3B decision model that llama.cpp b11485 or later serves at
`/v1/systemone`. Download `d1-3B-Q8_0.gguf`, then run:

```sh
llama-server --model d1-3B-Q8_0.gguf --alias d1-3B --host 127.0.0.1 --port 30001
```

Choose Custom, enter `localhost:30001` and model name `d1-3B`. The same
reachability and API-key rules apply. Existing endpoints, model names, keys
and limits are not changed by this recommendation.

![Custom setup, shown with the Liquid d1 alternative](docs/decision-setup.png)

### How much reaches your Inbox

The model rates five chances for each message: that it asks you for
something, that it reports a problem, that you act next, that the agent has
more to do, and that it is worth reading now. A thread stays parked only when
every chance is under its limit. Models rate differently, but limits are
stored per provider (TypeSafe Jev or Custom), not per custom model name. Custom's defaults were tuned on Liquid d1, which
kept 23 of 24 routine test messages parked and brought back all 24 that needed
you in that evaluation. These results are not d3-flash calibration results.
When changing custom models, use Try it and Activity to check representative
messages and adjust the limits. The existing defaults are preserved.

Choose Less, Balanced, More or Custom, where you set each limit yourself. Before you
save, Beside shows how your recent verdicts would have changed.

The Activity tab lists recent decisions with the chances behind each one.

![Activity tab with a verdict opened to show its chances](docs/decision-activity.png)

The Try it tab shows what the model would do with a message you paste.

![Try it tab bringing back a message that asks for approval](docs/decision-try.png)

Mute and Unmute are in bb's thread menu. Muting also turns off the thread's
push notifications, and unmuting puts back the level it had before.

## Where your data lives

Beside keeps its state in its own database on the bb server: which threads are
snoozed, settled or muted, which shelves and parents you collapsed, your
settings and the last 500 decision model verdicts. Nothing is added to bb's own threads. Your layout follows you to
every device, and uninstalling the plugin removes its state. Beside sends nothing
anywhere unless you set a decision model endpoint.

## Limits

- Beside uses bb's experimental plugin APIs, so a bb update can break it.
- Above 150 threads, rows far from view are drawn as simple placeholders and
  become full rows as you scroll to them, like bb's own list.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run build` uses the pinned `bb-app` to run `bb plugin build`.

## Credits

Beside started as t3sidebar by Michael Yong, from
[SawyerHood/sawyer-plugins](https://github.com/SawyerHood/sawyer-plugins).

## Licence

MIT
