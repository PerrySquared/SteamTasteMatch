# SteamTasteMatch
A browser extension that generates a personalized score for a game you haven’t reviewed yet by comparing your ratings with users who have reviewed it. The score is weighted by how closely your tastes match, based on overlapping games you’ve both reviewed.

---

## The Problem 

Steam aggregates reviews into a single summary (e.g., **“Mixed (68%)”**).
This global percentage does not account for user preference.

A game rated 68% positive overall may be strongly favored by users with similar tastes to yours. Steam does not provide a mechanism to isolate that segment.

---

## The (Slow) Solution

This extension:

* Reads your Steam reviews
* Identifies reviewers who consistently agree with your ratings in overlapping games
* Calculates the percentage of those aligned reviewers for a given game

## Installation

### Chromium

1. Download this repository folder.
2. Navigate to:

   ```
   chrome://extensions/
   ```
3. Enable **Developer mode**.
4. Click **Load unpacked** → Select the folder.

---

## Setup

1. Retrieve your Steam ID or profile URL / URL name
2. Paste it into the extension
3. Ensure your Steam profile is Public

---

## Usage

1. Open any Steam game page.
2. Click the extension icon.
3. Adjust the sliders.
4. Select **Analyze Reviews**.
5. Wait (Wait a lot if Max. Profiles number is over 200).
   * Desktop notification appears when analysis is completed.
6. View your personalized score.

The extension's popup can be closed during processing — analysis continues in the background.

---

## Settings

| Setting                      | Description                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| **Minimum Game Overlap**     | Minimum number of games that must overlap between you and other users  |
| **Minimum Taste Similarity** | % agreement required between your reviews and matched users            |
| **Maximum Profiles**         | Number of reviewers' profiles to analyze                               |

---

## How It Works

1. Scrapes your `/recommended/` page to collect your reviews.
2. Retrieves selected game's reviewers.
3. Fetches full review history for each reviewer.
4. Compares their thumbs-up/down decisions against yours for matching games.
5. Computes:
   * Overlap count
   * Agreement percentage
   * Personalized recommendation score

---

## Troubleshooting

**“No reviews found”**
→ Ensure your Steam profile is public.

**“0 matching reviewers”**
→ Reduce thresholds

**Slow or appears stuck**
→ Expected behavior. Scraping hundreds of profiles is time-intensive.
Check the extension log for progress.

**Rate limiting**
→ Be wary of scraping protection. If blocked DELAY_BETWEEN_REQUESTS can be adjusted.

---

# Privacy

- Runs locally in your browser
- Accesses publicly available Steam data
- No login required

---

# Limitations

- Really slow, getting a comprehensive overview from 100,000+ reviews is unfeasible (without a way to fetch all reviews from a user via API)
- No caching
- Rate-limit risk
- Susceptible to Steam HTML structure changes

---

# Fix Possibility

It could be possible to build an autoupdating review database that uses Valve's API, and group the fetched reviews from every request under relevant steamIDs. Then, likely, every request would be stripped down to something akin to "steamID + every (gameID + Rating)". This shouldn't weigh more than a dozen GBs, but could take days if not weeks to gather all data; there's also a possibility of API rate limits not being enough to keep up with the amount of the reviews posted daily. Also would require hosting and everything that comes with it. Might be worth looking into.
