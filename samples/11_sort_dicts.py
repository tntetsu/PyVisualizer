students = [
    {"name": "Alice", "score": 82},
    {"name": "Bob", "score": 95},
    {"name": "Carol", "score": 71},
    {"name": "Dave", "score": 88},
]
ranking = sorted(students, key=lambda s: s["score"], reverse=True)
for s in ranking:
    print(s["name"], s["score"])
