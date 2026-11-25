# Phase 6（公開後の拡充）：デコレーター・with・match（ADR-012）


# 自作のデコレーター
def trace(f):
    def wrapper(*args):
        print("call", f.__name__, args)
        return f(*args)
    return wrapper


def repeat(n):
    def deco(f):
        def w():
            for _ in range(n):
                f()
        return w
    return deco


@trace
def add(a, b):
    return a + b


print(add(1, 2))


@repeat(2)
def hello():
    print("hello")


hello()


# property・staticmethod・classmethod
class Temp:
    count = 0

    def __init__(self, c):
        self._c = c
        Temp.count += 1

    @property
    def c(self):
        return self._c

    @c.setter
    def c(self, v):
        if v < -273:
            raise ValueError("too cold")
        self._c = v

    @property
    def f(self):
        return self._c * 9 / 5 + 32

    @staticmethod
    def unit():
        return "C"

    @classmethod
    def made(cls):
        return cls.count


t = Temp(10)
t.c = 20
print(t.c, t.f, Temp.unit(), t.unit(), Temp.made(), t.made())
try:
    t.f = 3
except AttributeError:
    print("AttributeError")
try:
    t.c = -300
except ValueError as e:
    print("ValueError", e)


# with（自作のコンテキストマネージャー）
class Opened:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        print("enter", self.name)
        return self

    def __exit__(self, et, ev, tb):
        print("exit", self.name, et.__name__ if et else None)
        return et is ZeroDivisionError


with Opened("a") as a, Opened("b") as b:
    print("body", a.name, b.name)
with Opened("c"):
    x = 1 / 0
print("after")


def find(items, target):
    with Opened("search"):
        for i, v in enumerate(items):
            if v == target:
                return i
    return -1


print(find([5, 6, 7], 6))


# match
def describe(x):
    match x:
        case 0 | 1:
            return "small"
        case int(n) if n < 0:
            return f"negative {n}"
        case [first, *rest]:
            return f"list {first} {rest}"
        case {"name": nm, **others}:
            return f"dict {nm} {others}"
        case str() as s:
            return "str " + s
        case (p, q):
            return f"pair {p} {q}"
        case None:
            return "none"
        case True:
            return "true"
        case _:
            return "other"


for value in [0, -5, [1, 2, 3], (7, 8), {"name": "x", "k": 1}, "hi", None, True, 3.5, [], ()]:
    print(describe(value))


class Point:
    __match_args__ = ("x", "y")

    def __init__(self, x, y):
        self.x = x
        self.y = y


for pt in [Point(0, 0), Point(0, 5), Point(2, 3)]:
    match pt:
        case Point(0, 0):
            print("origin")
        case Point(x=0, y=yy):
            print("on y", yy)
        case Point(px, py):
            print("at", px, py)

command = "go north"
match command.split():
    case ["go", direction]:
        print("going", direction)
    case ["quit"]:
        print("bye")
match = 3
print(match + 1)
