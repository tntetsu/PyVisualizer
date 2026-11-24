s = "  Hello, World  "
print(s.strip(), s.upper(), s.lower().strip(), s.split(","), "a-b-c".split("-"))
print("-".join(["x", "y", "z"]), "banana".replace("a", "o"), "banana".find("n"), "banana".count("a"))
print("abc".startswith("ab"), "abc".endswith("bc"), "123".isdigit(), "abc".isalpha(), "x".isdigit())
print(repr("it's"), repr('say "hi"'), str(None), repr([1, "a", None, True, 2.0]))
name = "Py"
v = 3.14159
print(f"{name}!", f"{v:.3f}", f"{42:5d}|", f"{'x':<4}|", f"{7:03}", f"{1234567:,}", f"{0.25:.1%}", f"{{}}")
d = {"a": 1, "b": 2}
d["c"] = 3
d["a"] += 10
print(d, len(d), d.get("z"), d.get("z", 0), list(d.keys()), list(d.values()))
for k, v in d.items():
    print(k, v, end="; ")
print()
print(d.pop("b"), d, "a" in d, {"x": [1, 2]})
