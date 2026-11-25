def safe_div(a, b):
    try:
        result = a // b
    except ZeroDivisionError:
        result = None
    else:
        result = result * 10
    finally:
        print("finally", a, b)
    return result

print(safe_div(7, 2), safe_div(1, 0))

def parse(texts):
    out = []
    for t in texts:
        try:
            out.append(int(t))
        except ValueError as e:
            out.append(type(e).__name__)
    return out

print(parse(["1", "x", "3"]))

def lookup(d, keys):
    found = []
    for k in keys:
        try:
            found.append(d[k])
        except (KeyError, IndexError) as e:
            found.append("missing")
    return found

print(lookup({"a": 1}, ["a", "b"]))

def check(n):
    if n < 0:
        raise ValueError("negative: " + str(n))
    return n

def run(values):
    total = 0
    for v in values:
        try:
            total += check(v)
        except ValueError as e:
            print("caught", e, e.args)
            continue
    return total

print(run([1, -2, 3]))

try:
    try:
        raise KeyError("k")
    except KeyError:
        print("inner")
        raise
except LookupError as e:
    print("outer", type(e).__name__, isinstance(e, KeyError), isinstance(e, Exception))

def early():
    try:
        return "try"
    finally:
        print("cleanup")

print(early())

count = 0
for i in range(5):
    try:
        if i == 3:
            break
        count += 1
    finally:
        count += 100
print(count)

try:
    assert 1 + 1 == 3, "math"
except AssertionError as e:
    print("assert", e)

e = "kept"
try:
    raise RuntimeError
except RuntimeError as e:
    pass
print("e" in dir() if False else "done")
