fruits = [
    {"name": "banana", "color": "yellow"},
    {"name": "apple", "color": "red"},
    {"name": "cherry", "color": "red"},
    {"name": "blueberry", "color": "blue"},
]
ordered = sorted(fruits, key=lambda f: f["name"])
for f in ordered:
    print(f["name"], f["color"])
