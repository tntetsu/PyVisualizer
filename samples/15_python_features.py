words = "the quick brown fox jumps over the lazy dog the end".split()
counts = {}
for w in words:
    counts[w] = counts.get(w, 0) + 1

total = 0
for w, c in counts.items():
    if c > 1:
        print(f"{w:>5}: {c}")
    total += c

scores = [72, 88, 95, 61]
avg = sum(scores) / len(scores)
print(f"avg={avg:.2f}", scores[::-1], scores[1:3], max(scores) - min(scores))
print(total == len(words), 0 < avg <= 100, 7 // 2, -7 % 3, 2 ** 10)
