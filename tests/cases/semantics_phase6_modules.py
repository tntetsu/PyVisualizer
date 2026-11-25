# Phase 6（公開後の拡充）：random・datetime・collections・copy・statistics・string（ADR-013）
import random
from datetime import date, datetime, timedelta
from collections import Counter, defaultdict, deque
import copy
import statistics
import string

# random（seed を決めれば CPython と同じ列になる）
random.seed(2026)
dice = [random.randint(1, 6) for _ in range(10)]
print(dice)
cards = list(range(1, 11))
random.shuffle(cards)
print(cards, random.choice("ABC"), random.sample(range(100), 4))
print(round(random.random(), 6), round(random.uniform(10, 20), 6), random.randrange(0, 50, 5))
print(random.choices(["win", "lose"], weights=[1, 3], k=6))

# datetime
d = date(2026, 11, 25)
print(d, repr(d), d.year, d.month, d.day, d.weekday(), d.isoweekday())
print(d + timedelta(days=10), d - timedelta(weeks=2), date(2027, 1, 1) - d)
print(d.strftime("%Y/%m/%d %A %B %j"), d.isoformat(), d.replace(day=1))
dt = datetime(2026, 11, 25, 14, 30, 5)
print(dt, repr(dt), dt.hour, dt.minute, dt.date(), dt.isoformat())
print(dt + timedelta(hours=10, minutes=45), dt - datetime(2026, 1, 1))
print(dt.strftime("%H:%M:%S %p %I %a %b"), datetime.strptime("2024-02-29 08:15", "%Y-%m-%d %H:%M"))
span = timedelta(days=1, hours=2, minutes=3, seconds=4)
print(span, repr(span), span.total_seconds(), -span, span * 2, span / 2, span // timedelta(hours=1))
print(timedelta(seconds=90), timedelta(0), timedelta(milliseconds=1500), abs(timedelta(days=-1)))
print(d < date(2026, 12, 1), dt == datetime(2026, 11, 25, 14, 30, 5), sorted([date(2026, 3, 1), date(2025, 1, 1)]))
deadlines = {date(2026, 12, 1): "report"}
print(deadlines[date(2026, 12, 1)], date.fromisoformat("2026-01-31"), date(2024, 2, 28) + timedelta(days=1))

# collections
words = "the cat and the hat and the bat".split()
counts = Counter(words)
print(counts, counts["the"], counts["dog"], counts.most_common(2))
counts.update(["cat", "cat"])
print(counts.most_common(1), sum(counts.values()), counts.total())
print(Counter("hello") + Counter("world"), Counter(a=3, b=1) - Counter(a=1, b=2))
groups = defaultdict(list)
for w in words:
    groups[len(w)].append(w)
print(groups, dict(groups))
tally = defaultdict(int)
for ch in "banana":
    tally[ch] += 1
print(tally)
q = deque([1, 2, 3])
q.append(4)
q.appendleft(0)
print(q, q.popleft(), q.pop(), q, len(q), q[0])
q.rotate(1)
print(q)
last3 = deque(maxlen=3)
for i in range(5):
    last3.append(i)
print(last3, list(last3))

# copy
grid = [[0, 0], [0, 0]]
shallow = copy.copy(grid)
deep = copy.deepcopy(grid)
grid[0][0] = 9
print(grid, shallow, deep, shallow[0] is grid[0], deep[0] is grid[0])

# statistics
scores = [72, 88, 95, 61, 88]
print(statistics.mean(scores), statistics.median(scores), statistics.mode(scores))
print(statistics.mean([1, 2, 3, 4]), statistics.median([1, 2, 3, 4]), statistics.median_low([1, 2, 3, 4]))
print(round(statistics.stdev(scores), 6), round(statistics.pstdev(scores), 6), statistics.variance([1, 2, 3, 4]))
print(statistics.multimode("aabbc"), statistics.mean([0.5, 1.5]))

# string
print(string.ascii_lowercase, string.digits, string.punctuation[:5], string.capwords("hello big world"))
