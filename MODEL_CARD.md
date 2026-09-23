---
license: mit
language:
  - en
pipeline_tag: text-classification
base_model: jhu-clsp/ettin-encoder-32m
tags:
  - onnx
  - browser
  - chrome-extension
  - local-first
  - social-media
  - twitter
  - x.com
  - tweet-scoring
  - twitter-scoring
  - virality-score
  - engagement-prediction
  - social-media-scoring
  - post-scoring
---

# Scoreboar v8: on-device X post scoring

Scoreboar predicts how an X (Twitter) post will do compared with ordinary posts from accounts of the same size. It is a 32M-parameter encoder exported to ONNX (128 MB) that runs inside a Chrome extension in about 30 ms per post. No text leaves the browser.

v8 is a retrain from the ground up. Earlier versions learned to copy an LLM's opinion of the text. v8 learns from what actually happened to about 23,500 fresh posts (plus 48k older ones): their likes, reposts, replies, quotes and views, compared with what the author's reach would predict.

What that buys a writer: on 1,230 held-out posts from authors it never trained on, v8 picks which of two posts did better for its account size 61% of the time. grok-4.7 asked the same question gets 55%, Jev 52.5%, the previous Scoreboar 52%, and a coin flip 50%. Posts v8 rates in its top fifth ended up in the real bottom fifth only 6% of the time, against 20% by chance. It still gets many single posts wrong. Use it to catch weak drafts and tilt the odds; it does not promise reach.

Source code and the extension: <https://github.com/Siim/scoreboar-twitter-x-virality>

![Scoreboar v8 scoring posts on an X timeline](https://huggingface.co/siimh/scoreboar-twitter-x-virality/resolve/main/assets/scoreboar-v8.png)

## What the numbers mean

The headline output, `performance`, is a percentile. A value of 0.46 means the post is expected to beat 46% of ordinary posts **after accounting for account size**. A small account can score 90 and a large one can score 10.

Beside it the model gives:

- the chance the post lands in each fifth of ordinary posts (calibrated, so "top fifth 16%" means roughly one in six such posts get there),
- expected engagement and views as multiples of what the account usually gets,
- explanation heads trained on grok-4.7 labels: opening line, clarity, novelty, how human it sounds, whether it draws replies, and flags for rage bait, clickbait, AI slop and missing context.

The explanation heads describe the text. They are not the forecast.

## Evaluation

Held-out test set: 1,230 ordinary posts (English, no replies), at least 72 hours old, from 1,186 authors whose posts were never used for training or calibration. Real performance is the target described under Training: a post's engagement (likes, reposts, replies, quotes) and views compared with what its account size predicts. So "better" always means better for the account's size. Intervals are 95% bootstrap over posts; resampling by author gives nearly the same intervals.

### In plain numbers

| Signal | Picks the better of two posts | Picks a clear winner over a clear loser | Top-fifth hit rate |
|---|---|---|---|
| **Scoreboar v8** | **61.4%** (59.8 to 63.1) | **77.1%** (72.6 to 80.9) | **34.6%** (29.3 to 39.4) |
| grok-4.7 asked to forecast performance | 55.3% (53.4 to 57.2) | 61.1% (55.4 to 65.7) | 29.2% (24.3 to 34.3) |
| grok-4.7 virality score | 53.4% (51.5 to 55.3) | 56.5% (51.1 to 61.4) | 25.0% (20.3 to 29.9) |
| Jev asked to forecast performance | 52.5% (50.5 to 54.3) | 55.8% (50.2 to 60.7) | 23.3% (18.6 to 28.7) |
| Previous Scoreboar release (`v5-full.onnx`) | 52.0% (50.1 to 53.9) | 53.5% (48.3 to 58.8) | 22.8% (18.3 to 28.0) |
| Coin flip | 50% | 50% | 20% |

![At predicting how X posts perform, Scoreboar v8 beats Grok 4.7 and Jev](https://huggingface.co/siimh/scoreboar-twitter-x-virality/resolve/main/assets/scoreboar-v8-versus.png)

- **Picks the better of two posts.** Over every pair of test posts, how often the model scores higher the one that did better. A tie in the model's score counts as half. grok-4.7 gives tied scores on 2.7% of pairs and Jev on 0.8%; dropping those pairs moves their rates by 0.2 points at most.
- **Picks a clear winner over a clear loser.** Pairs of one post from the real top fifth and one from the real bottom fifth. The median top-fifth post got 54 likes and 1.7k views, about 6 times what its account size predicts. The median bottom-fifth post got 0 likes and 65 views, a fifth to a quarter of the prediction. This is the easy case and should not be read as overall accuracy.
- **Top-fifth hit rate.** Of the posts each model ranks in its own top fifth, the share that really landed in the top fifth. Chance is 20%, so v8 is at about 1.7 times chance.

The other side of the hit rate: of the posts v8 ranks in its top fifth, 5.7% (2.8 to 8.5) landed in the real bottom fifth, against 20% by chance. For Jev's top picks it is 17.5% (13.4 to 22.4) and for grok-4.7's forecast 19.1% (15.0 to 24.0), both close to chance.

v8's lead, in percentage points with 95% intervals:

| v8 minus | Better of two | Clear winner over clear loser | Top-fifth hit rate |
|---|---|---|---|
| grok-4.7 forecast | +6.1 (3.8 to 8.5) | +16.0 (10.6 to 22.3) | +5.3 (-2.2 to +12.2), within the noise |
| Jev forecast | +8.9 (6.8 to 11.2) | +21.3 (15.8 to 27.2) | +11.3 (3.8 to 17.9) |
| Previous Scoreboar | +9.3 (7.1 to 11.8) | +23.6 (16.9 to 29.5) | +11.8 (3.3 to 18.7) |

Almost every test pair is two different people's posts. Picking the better of two drafts from the same account was not tested on its own: the test set has only 64 such pairs (v8 56%, Jev 54%), too few to say anything.

**About the comparison.** It covers one job: predicting how an X post performs for its account size. Jev is TypeSafe's text classifier. It is cheap ($5.43 to label 87,288 posts) and good at describing what a post is, and it was not built to forecast X engagement. grok-4.7 is a general model asked the same question. Both saw the same post and context (account size, verification, media type, quote, link, posting time), and neither saw the outcome. v8 learned from outcomes.

**How hard is this?** Some of the signal is in the format alone, so a few points above 50% is not hard to get.

- The one-line rule "a post with a photo or video beats one without" picks the better post 54.2% of the time.
- A small LightGBM model trained on the same outcomes that never reads the text (media, photo, video, quote and link flags, length, line breaks, hashtags, mentions) gets 58.2%, 71.5% and a 37.0% top-fifth hit rate. v8 beats it by 3.2 points (1.2 to 5.2) and 5.7 points (0.6 to 10.7) on the first two. On the top-fifth hit rate it does not: -2.6 points (-9.3 to +4.1).
- Where only the words differ, on the 616 test posts with no media and no link, v8 picks the better post 61.7% of the time, grok-4.7's forecast 52.1% and Jev 52.5%. That is 9.2 points over Jev (6.5 to 12.4).

Learning what format does on X gets an outcome-trained model a long way. Reading the text adds the rest, and it matters most on plain-text posts.

### Technical detail

Rank correlation is Spearman against real performance. Epochs were picked on the calibration split; the experiments under "What did not help" were compared on this test set. Those variants differed by about 0.03 in correlation, far less than the gaps between v8 and the other signals, but v8's numbers may be slightly optimistic for it. One more small leak: the account-size baseline behind the target was fitted out-of-fold on all ordinary posts, test posts included, so test outcomes reached the training labels weakly and indirectly. The training code has since been changed to keep test posts out of that fit. Retrained that way, with calibration authors also kept out of training, the same model scores 0.337 against v8's 0.338 on the same test targets, so the leak did not inflate these numbers.

| Signal | Rank correlation | AUC, top fifth |
|---|---|---|
| **Scoreboar v8** | **0.34** (0.29 to 0.39) | **0.68** |
| v8 trained with Jev as a second teacher | 0.32 (0.27 to 0.37) | 0.69 |
| grok-4.7 asked to forecast performance | 0.16 (0.11 to 0.22) | 0.61 |
| grok-4.7 virality score | 0.10 (0.05 to 0.16) | 0.58 |
| Jev asked to forecast performance | 0.07 (0.02 to 0.13) | 0.53 |
| Previous Scoreboar release (`v5-full.onnx`) | 0.06 (0.00 to 0.11) | 0.54 |

![Rank correlation with real performance on the 1,230 held-out posts](https://huggingface.co/siimh/scoreboar-twitter-x-virality/resolve/main/assets/scoreboar-v8-eval.png)

More detail on the same test set:

- engagement vs. expected: 0.27; views vs. expected: 0.39
- fifth accuracy: 28% (chance is 20%)
- calibration of the fifth probabilities: expected calibration error 0.014, Brier 0.781, log loss 1.555 (a uniform guess gives 0.800 and 1.609)
- explanation heads vs. grok-4.7 labels: mean absolute error 0.89 on the 0 to 10 scores, 88% agreement on the five flags

A rank correlation of 0.34 is useful for spotting weak drafts and tilting the odds. It is far from certain. Two posts a few points apart are a coin flip.

The previous model card reported 59% bucket accuracy. That number measured agreement with teacher-derived buckets, not with what posts did. Against real outcomes that model scored 0.06, and it picked the better of two posts 52% of the time.

## Training

**Data.** 87,288 posts in total.

| Set | Posts | Used for |
|---|---|---|
| Ordinary posts, Sept 2026, ≥72 h old | 6,000 | outcomes, grok-4.7 labels, calibration and test |
| Posts with 20 to 499 likes | 1,838 | outcomes, grok-4.7 labels |
| Posts with 500+ likes | 1,453 | outcomes, grok-4.7 labels |
| Posts under trending topics in 10 regions | 17,718 | outcomes (0.8 weight), grok-4.7 labels for 12,000 |
| Older viral-search posts (earlier dataset) | 50,279 | outcomes (0.5 weight) |
| Older regular posts (earlier dataset) | 10,000 | carried in the table, no loss weight after the old labels were dropped |

Mid, popular, trending and viral-search posts were found through engagement floors, so they over-represent winners. During training a stratum input tells the model how each post was found; the export pins it to "ordinary", so the shipped model scores every post as an ordinary one.

**Target.** For each post, log engagement and log views are compared with a LightGBM baseline fitted out-of-fold on ordinary posts from the author's followers, following, post count, likes given, account age, verification and the post's age. The two residuals are standardized and averaged. The model predicts this average, both residuals, and which fifth it falls in.

**Teacher.** grok-4.7 with low reasoning effort labelled 21,285 of the fresh posts against a fixed rubric (13 scores, 5 flags, 4 categories), for $53 ($59 with the pilots). The other trending posts train on outcomes only. The older grok-4.3 labels were dropped.

**Splits.** Ordinary posts are split by author 60/20/20 into train, calibration and test. No test author's posts appear anywhere in training.

**Model.** [Ettin-encoder-32m](https://huggingface.co/jhu-clsp/ettin-encoder-32m) (MIT) with a 22-value metadata vector fused into the pooled text, then heads for the outcome, the fifths, and the teacher labels. 3 epochs, batch 64, max 128 tokens. Ettin-68m scored the same (0.312 on the test set, outcome-only runs), so the smaller model ships.

**Calibration.** Fitted on the calibration split and baked into the ONNX graph: piecewise-linear knots that map the raw outcome to a percentile of ordinary posts, a temperature for the fifth probabilities, and one temperature per flag.

### What did not help

- **Jev as a second teacher.** Jev (TypeSafe's text classifier) labelled all 87,288 posts for $5.43, with soft labels for 9 scores, 5 flags and 3 categories. Trained with both teachers, the model's explanation heads matched grok-4.7 a little better (error 0.86 vs 0.89), but the forecast did not improve: 0.32 vs 0.34, a paired difference of +0.016 in favour of v8 alone (95% interval -0.002 to +0.034). In plain numbers it picked the better of two posts 60.9% of the time against v8's 61.4%, no real difference. Jev and grok-4.7 agree closely on what a post *is* (0.64 to 0.82 correlation on novelty, authenticity, hook and clarity) and much less on how it will do (0.40). Both teachers saw the same post and context (account size, verification, media type, quote, link, posting time), and neither saw the outcome. The forecast comes from real outcomes, and a second opinion on the same post adds no information about how X's audience responds to it.
- **More ordinary posts.** 887, 1,773 and 3,547 ordinary training posts gave 0.265, 0.311 and 0.312 on the test set.
- **The Grok teacher, for the forecast.** Training on outcomes alone scored 0.324; adding grok-4.7 labels gave 0.337. The labels are worth keeping for the explanations, but the forecast comes almost entirely from outcomes.
- **INT8 quantization.** It cut the file size but moved the scores more than the calibration allows, so the model ships in FP32. Unpadded inputs and a smaller encoder bought the speed instead.

## Inputs

Text is normalized before tokenizing: URLs become `[link]`, and media links are dropped. The metadata vector has 22 values: media, photo, video, quote and link flags; UTC hour and weekday as sine and cosine; author followers, following, posts, verification and organization verification (with an `author_known` flag); likes given and account age (with an `author_details_known` flag); text length, line breaks, hashtags and mentions.

Unknown values are neutral and flagged, never zero-filled. For example, a quote status that is unknown is 0.25, and media of unknown type counts as 0.7 photo and 0.3 video.

In order, with counts and lengths taken from the normalized text:

| # | Name | Value |
|---|---|---|
| 1 | `has_media` | 1 if the post has a photo, video or GIF |
| 2 | `has_photo` | 1 or 0; 0.7 when there is media of unknown type |
| 3 | `has_video` | 1 or 0, GIFs included; 0.3 when there is media of unknown type |
| 4 | `is_quote` | 1 or 0; 0.25 when unknown |
| 5 | `has_link` | 1 if the text has a link or the post has a link card |
| 6, 7 | `hour_sin`, `hour_cos` | UTC time of posting on a 24-hour circle; both 0 when unknown |
| 8, 9 | `weekday_sin`, `weekday_cos` | UTC weekday (Monday is 0) on a 7-day circle; both 0 when unknown |
| 10 | `author_known` | 1 when the author's follower count is known |
| 11 | `log_followers` | ln(1 + followers) / 20; 0 when the author is unknown |
| 12 | `log_following` | ln(1 + following) / 20; 0 when the author is unknown |
| 13 | `log_statuses` | ln(1 + posts) / 20; 0 when the author is unknown |
| 14 | `author_verified` | 1 if the author is known and verified |
| 15 | `author_org_verified` | 1 for business or government verification |
| 16 | `author_details_known` | 1 when the account's creation date is known |
| 17 | `log_favourites` | ln(1 + likes given) / 20; 0 when details are unknown |
| 18 | `account_age` | account age in years at posting time / 20, capped at 20 years |
| 19 | `log_text_chars` | ln(1 + characters) / 8, capped at 1 |
| 20 | `line_breaks` | line breaks / 20, capped at 20 |
| 21 | `hashtag_count` | hashtags / 10, capped at 10 |
| 22 | `mention_count` | mentions / 10, capped at 10 |

The exact contract lives in `src/contracts.ts` (TypeScript) and in the Python trainer. `fixtures/feature-contract-v2.json` pins both to the same outputs for a set of reference posts. Feeding the model differently prepared inputs gives different scores. To run the model outside the extension with the same preparation, [`examples/express-service`](https://github.com/Siim/scoreboar-twitter-x-virality/tree/main/examples/express-service) wraps it in a small HTTP API.

## Outputs

| Name | Shape | Meaning |
|---|---|---|
| `performance` | [batch] | calibrated percentile among ordinary posts, 0 to 1 |
| `outcomes` | [batch, 3] | predicted standardized performance, log engagement residual, log views residual (`exp` of the residuals gives the multiples) |
| `virality_logits` | [batch, 5] | calibrated logits for the five fifths, lowest first |
| `numeric_scores` | [batch, 13] | explanation scores, 0 to 1 (grok-4.7's 0 to 10 rubric divided by 10) |
| `boolean_logits` | [batch, 5] | calibrated logits: rage bait, clickbait, AI slop, needs context, clear takeaway |
| `categorical_logits_*` | [batch, n] | primary emotion, target audience, content type, expected likes band |

Inputs are `input_ids` and `attention_mask` (int64, [batch, sequence], up to 128 tokens) and `metadata` (float32, [batch, 22]). Output and feature names are listed in `scoreboar-v8.json`.

### What each head holds

The extension reads the first five outputs:

- `performance`: the headline percentile, shown as "Beats N% of posts".
- `outcomes`: standardized performance, then the log engagement residual and the log views residual, all relative to what the author's reach predicts. `exp` of the last two gives the engagement and views multiples.
- `virality_logits`: the fifths in order `very_low`, `low`, `medium`, `high`, `very_high`. The calibration temperature is already in the graph, so a plain softmax gives the calibrated chances.
- `numeric_scores`, 0 to 1 (multiply by 10 for the rubric scale), in order: `virality_score`, `hook_quality`, `clarity_score`, `novelty_score`, `emotional_intensity`, `controversy_level`, `shareability_score`, `conversation_potential`, `authenticity_score`, `urgency_level`, `call_to_action_strength`, `trend_alignment`, `expected_performance`.
- `boolean_logits`, in order: `is_rage_bait`, `is_clickbait`, `is_ai_slop`, `needs_context`, `has_clear_takeaway`. The per-flag temperatures are in the graph too, so a plain sigmoid gives the calibrated chances.

`virality_score` and `expected_performance` are learned from grok-4.7's own guesses at how a post will do, and those guesses predicted real outcomes poorly (see Evaluation). Use `performance` for the forecast.

The four categorical heads were extra supervision during training. They are in the export, but the extension does not show them and they are not calibrated. Classes in index order, as in `label_maps` in `scoreboar-v8.json`:

| Output | Classes |
|---|---|
| `categorical_logits_primary_emotion` | anger, anticipation, curiosity, disgust, fear, humor, inspiration, joy, neutral, outrage, sadness, surprise, trust |
| `categorical_logits_target_audience` | business, crypto, entertainment, finance, gaming, general, lifestyle, news, politics, science, sports, tech |
| `categorical_logits_content_type` | advice, announcement, complaint, joke, meme, news, observation, opinion, promotion, question, story, thread |
| `categorical_logits_expected_likes_band` | 0, 1-4, 5-19, 20-99, 100-499, 500-1999, 2000-9999, 10000+ |

`expected_likes_band` is grok-4.7's guess at a like count, not a forecast from outcomes.

## Files

| File | Size | SHA-256 |
|---|---|---|
| `scoreboar-v8.onnx` | 128 MB | `f085acf285b64a4d64b5c3886a49683895a0f832d7fbe7168002fb27dcf34cf3` |
| `scoreboar-v8.json` | 3 KB | `29fff72a3f09d22fad19e9bfa41d20268cc4f320e0ec75d33bd4c4834579bed9` |
| `tokenizer.json` | 3.6 MB | `fe530b837c912faf33acd6b1a15a46234259519acb967ead693c692cc2e93647` |

`v5-full.onnx` stays in this repo for builds of the previous extension. It needs the old 12-value metadata vector and is not compatible with v8's inputs.

## Speed

Measured in Chrome with ONNX Runtime Web (WASM) on an Apple M3 Max, typical post length:

| | Per post | Model size |
|---|---|---|
| Previous release, padded to 192 tokens as the old extension ran it | 1,010 ms | 597 MB |
| v8, unpadded | 30 ms | 128 MB |

## Limitations

- Trained on posts from September 2026 and earlier. X's audience and ranking change, and so will what works.
- Mostly English. Other Latin-script languages appear in the data; non-Latin trends were filtered out.
- It sees text and metadata, not images or video content, and not who replies or reposts.
- It predicts performance relative to account size. It does not say how many likes a post will get.
- Engagement is not quality. A post can score low and be worth writing.

## Not intended for

Moderation, enforcement, ranking people, or any decision about a person. Scores are writing feedback.

## Privacy

The extension runs the model in a Chrome offscreen document. It has no backend and no telemetry, and it does not call the X API. Author statistics come only from data X has already loaded into the page.

## Citation

Scoreboar builds on Ettin:

```bibtex
@misc{weller2025seqvsseqopen,
  title={Seq vs Seq: An Open Suite of Paired Encoders and Decoders},
  author={Orion Weller and Kathryn Ricci and Marc Marone and Antoine Chaffin and Dawn Lawrie and Benjamin Van Durme},
  year={2025},
  eprint={2507.11412},
  archivePrefix={arXiv},
  primaryClass={cs.CL},
  url={https://arxiv.org/abs/2507.11412}
}
```
