# Simultaneous Machine Translation for Indian Languages

### Translating Indian languages into English *while the speaker is still talking*

**Project:** IASNLP 2026 — Simultaneous Machine Translation (SiMT)
**Languages:** Telugu, Hindi, Gujarati, Tamil ↔ English
**Hardware I worked on:** a laptop in a Docker container — single RTX 3060 with 6 GB of
GPU memory, 12 GB system RAM.

This document is a plain-language tour of the project: what it does, what I built, and —
most importantly — *why* I made the choices I did given the machine and time I had.

---

## 1. The problem

Normal machine translation waits for the **whole sentence**, then translates it.
*Simultaneous* translation can't do that: it has to start producing output while the
speaker is **still mid-sentence** — like a human interpreter. The challenge is producing
a good translation from only a *partial* sentence.

This is especially hard for Indian languages → English:

- Indian languages are **SOV** ("I rice eat") while English is **SVO** ("I eat rice").
- The **verb usually comes last**, so the single most important word often arrives at the
  very end. Committing to a translation early — before you've heard the verb — is genuinely
  risky.

There's a second, sneakier problem. A translation model has only ever been trained on
**complete sentences**. If you feed it a half-finished sentence at run time, you've changed
the rules on it — this *train/test mismatch* makes quality drop.

---

## 2. The approach (the intuition)

I tackled this with three ideas, from simplest to most advanced:

- **Wait-k** — the core policy. Wait for the first *k* words, then emit one translated
  word for every new source word that arrives. The number *k* is a dial: a **small k**
  means you start sooner but with less context (lower quality); a **large k** means you
  wait longer but translate better. This single dial captures the whole
  *speed-vs-quality* trade-off at the heart of simultaneous translation.

- **SimulMask** — a smarter *training* trick. Instead of literally chopping sentences in
  half to teach the model about partial input, I train on full sentence pairs but **hide
  part of the model's attention** so each output word can only "look at" the source words
  it would actually have seen at that moment. The model learns streaming behaviour *and*
  keeps its full-sentence ability.

- **Adaptive policies** (no extra training needed) — instead of a fixed *k*, let the model
  decide *when* it's safe to commit a word:
  - **Local Agreement** — keep re-translating as new words arrive and only lock in a word
    once successive attempts agree on it.
  - **Confidence threshold** — only emit the next word when the model is confident enough;
    otherwise wait for more input.

---

## 3. Why I made these choices — *my conditions*

This is the part most shaped by my hardware. A 6 GB laptop GPU drove almost every
practical decision.

- **The model doesn't fit normally, so I quantize it.** The base translation model
  (`sarvam-translate`, a 4-billion-parameter model) needs ~8+ GB in its standard format —
  more than my 6 GB card has. So the project **automatically loads it in 4-bit**
  (a compressed form), which squeezes it into the 6 GB budget. Any fine-tuning uses
  **LoRA**, which trains a tiny add-on instead of the whole model.
  

- **The live demo runs the *base* model with wait-k — no fine-tuning required.** Given
  limited GPU time, I made a deliberate call: the wait-k *policy* can be demonstrated
  convincingly on the off-the-shelf model. Fine-tuning (SimulMask + LoRA) is the natural
  next improvement, but it isn't needed to *show the idea working*.

- **I leaned on the training-free adaptive policies** precisely because they give smarter
  streaming behaviour **without spending my scarce GPU budget on training**.

- **The speech demo is engineered around 6 GB.** For live "speak and watch it translate":
  - I run the speech-to-text (ASR) with **faster-whisper on the side**, not the browser's
    built-in recognizer — so it's self-contained and does real language detection.
  - I tuned how the speech model and the translation model **share the one small GPU** so
    they coexist without running out of memory.
  - I fixed an early bug where long translations would **stop midway** (the old streaming
    decoder was too slow and got cut off) by translating the settled part of the sentence
    in the background and doing one clean full pass at the end.
  - There's an optional **remote-LLM backend**: on demo day, translation can be offloaded
    to another machine, which frees my laptop GPU to run the speech model fast.

- **No quality scores in the live demo, on purpose.** At demo time there are no "correct
  answers" to compare against, so showing accuracy numbers would be meaningless — the
  priority there is a smooth, lag-free experience.

---

## 4. What I actually built

- **A training library** — wait-k prefix training plus SimulMask, using LoRA, configurable
  from a YAML file, and able to run on one GPU or scale across several (`waitk_finetune/`).

- **An evaluation framework** — measures both the fixed policies (full-sentence, wait-k)
  and the adaptive ones (Local Agreement, Confidence) on the standard **IN22** benchmark.
  It reports translation quality (**BLEU**, **COMET**) alongside latency
  (**Average Lagging** and a length-adjusted version, **LAAL**), across all 4 languages and
  both directions (`eval_simulmt.py`, `eval_adaptive.py`, with plotting in `plot_results.py`).

- **An interactive browser demo** — one clean screen where you can **type or speak**, and
  the translation streams out under the wait-k policy as you go (`frontend/`).

- **Data preparation and a one-command pipeline** — scripts to build training data and run
  the whole thing end-to-end (`prepare_*_data.py`, `run_full_pipeline.sh`).

---

## 5. Results

The clearest result is the **quality-vs-latency trade-off** on Telugu→English
(base model, before any fine-tuning):

| Text type      | Policy           | Quality (BLEU) | Lag (AL) |
|----------------|------------------|----------------|----------|
| Conversational | Full sentence    | ~30            | —        |
| Conversational | **Wait-3**       | **~30**        | low      |
| General        | Full sentence    | ~18.6          | —        |
| General        | Wait-3           | ~18.3          | higher   |

The headline: on conversational speech, **wait-3 matches full-sentence quality (~30 BLEU)
while starting to translate far earlier** — that's exactly the simultaneous-translation
win. Harder, general-domain text is lower (~18 BLEU), which is precisely where the
SimulMask fine-tuning would help next.

---

## 6. Scope and next steps

To be upfront: the live demo showcases the wait-k **policy** running on the base model.
The fine-tuning machinery (SimulMask + LoRA) is built and ready — applying it is the
natural next step to push quality on harder text. Model choice itself is constrained by
the 6 GB budget, so picking and tuning a model that streams well on small hardware is part
of the ongoing story.

**In one line:** I built a complete simultaneous-translation system for Indian languages —
training, evaluation, and a live type-or-speak demo — and engineered every part of it to
run on a single 6 GB laptop GPU.
