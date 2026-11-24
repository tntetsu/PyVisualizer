for v in [0, 1, 0.0, "", "a", [], [0], (), {}, None, True, False, range(0), range(2)]:
    if v:
        print("T", end=" ")
    else:
        print("F", end=" ")
print()
print([] or "empty", 0 and 1, 3 and 4, None or 0, not [], not 5)
x = 5
print(1 < x < 10, 1 < x > 10, 1 < 2 < 3 < 4, (1 < 2) < 3, x == 5 == 5.0)
print(3 in [1, 2, 3], "ab" in "cabd", 2 not in (1, 2), "k" in {"k": 1}, 4 in range(0, 10, 2))
print(None is None, [1] == [1], (1, 2) == (1, 2), [1, 2] < [1, 3], "abc" < "abd", (1, "a") < (1, "b"))
