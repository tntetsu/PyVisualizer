# Phase 6（公開後の拡充）：入門でよく使う書き方（ADR-011）

# 型注釈は読み飛ばす
def area(width: int, height: int = 2) -> int:
    return width * height


size: int = area(3)
label: str
print(size)

# * のアンパック
first, *rest = [1, 2, 3, 4]
*init, last = "abc"
head, *middle, tail = (1, 2, 3, 4, 5)
print(first, rest, init, last, middle)
print([*rest, 9], (*init,), {*rest}, [0, *range(3)])
for a, *bs in [(1, 2, 3), (4,)]:
    print(a, bs)

# :=
if (count := len(rest)) > 2:
    print("count", count)
values = [y := v * 2 for v in range(3)]
print(values, y)
data = [3, 8, 1]
while (n := len(data)) > 1:
    data.pop()
print(n, data)

# f 文字列の = と変換
pi = 3.14159
name = "Ada"
print(f"{pi=} {pi = :.2f} {name!r} {name!s:>5}")

# str.format
print("{} + {} = {}".format(1, 2, 3))
print("{0}{1}{0}".format("ab", "-"))
print("{name} is {age:3d} years".format(name="Bob", age=7))
print("{:>6.2f}|{:<4}|{:^7}|".format(pi, "x", "mid"))
print("{:.1%} {{braces}} {!r}".format(0.256, "q"))

# 組み込み関数
print(list(map(str, [1, 2, 3])), list(map(lambda p, q: p * q, [1, 2], [3, 4])))
print(list(filter(lambda x: x % 2 == 0, range(7))), list(filter(None, [0, "", "a", 2])))
print(any([0, 0, 3]), all([1, 2, 0]), any([]), all([]))
print(divmod(17, 5), divmod(-17, 5), divmod(7.5, 2))
print(pow(2, 10), pow(2, 0.5), pow(3, 4, 5), pow(7, 3, -5))
print(hex(255), bin(10), oct(64), hex(-16), bin(0))
print(int("ff", 16), int("0x1F", 16), int("0b101", 0), int("777", 8), int("z", 36), int("-10", 2))
it = iter([10, 20])
print(next(it), next(it), next(it, "done"))
# map に組み込みの関数を渡す（自作の関数は、PyVisualizer では map を呼んだときに全部呼ばれる。ADR-011）
squares = map(abs, [-1, -2, -3])
print(next(squares), list(squares), list(squares))
print(callable(print), callable(area), callable(3), callable(str))
print(format(pi, ".3f"), format(42, "08b"), format("x", "^5"), format(1234567, ","))
print(hash(10), hash(True), hash(-1), hash(2.0))

# 文字列のメソッド
print("7".zfill(3), "-7".zfill(4), "+3".zfill(3))
print("ab".center(6, "*"), "abc".center(6, "*"), "ab".center(5), "ab".center(7, "."))
print("ab".ljust(5, ".") + "|", "ab".rjust(5, "."))
print("hello world".title(), "hELLO wORLD".capitalize(), "PyThOn".swapcase())
print("abc123".isalnum(), "abc!".isalnum(), "  ".isspace(), "ABC".isupper(), "abc".islower(), "Ab".isupper())
print("banana".rfind("a"), "banana".index("n"), "banana".rindex("n"), "banana".find("z"))
print("key=value=x".partition("="), "key=value=x".rpartition("="), "abc".partition("z"))
print("a\nb\r\nc".splitlines(), "".splitlines(), "x\n".splitlines())
print("xxhixx".lstrip("x"), "xxhixx".rstrip("x"), "--hi--".strip("-"))
print("data.csv".endswith((".txt", ".csv")), "report.py".removesuffix(".py"), "test_a".removeprefix("test_"))
print("12".isdecimal(), "12".isnumeric(), "1.2".isdecimal())

# exit() で終わる
print("before exit")
exit()
print("not reached")
