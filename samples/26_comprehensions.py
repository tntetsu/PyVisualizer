words = ["apple", "banana", "cherry", "date"]
lengths = [len(w) for w in words]
long_words = [w.upper() for w in words if len(w) > 5]
first = {w[0]: w for w in words}
vowels = {c for w in words for c in w if c in "aeiou"}
print(lengths, long_words, first)
print(sorted(vowels), sum(n * n for n in range(4)))
