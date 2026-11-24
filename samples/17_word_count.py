text = "to be or not to be that is the question"
counts = {}
for word in text.split():
    counts[word] = counts.get(word, 0) + 1

pairs = {(1, 2): "A", (2, 1): "B"}
print(counts["to"], counts["be"], len(counts))
print(pairs[(2, 1)], 1 in {1: "one", 2: "two"})
