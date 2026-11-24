def add(a, b=10):
    return a + b

print(add(1), add(1, 2), add(b=5, a=1))

def append_to(x, acc=[]):
    acc.append(x)
    return acc

print(append_to(1), append_to(2))

count = 0
def inc():
    global count
    count += 1

inc()
inc()
print(count)

def outer():
    total = 0
    def add_to(n):
        nonlocal total
        total += n
    for i in range(4):
        add_to(i)
    return total

print(outer())

def no_return():
    pass

print(no_return())
square = lambda n: n * n
print(square(7), sorted([3, -4, 1], key=lambda v: abs(v)))

def classify(n):
    if n < 0:
        return "neg"
    elif n == 0:
        return "zero"
    else:
        return "pos"

print(classify(-1), classify(0), classify(5))

def loops():
    out = []
    for i in range(10):
        if i % 2 == 0:
            continue
        if i > 7:
            break
        out.append(i)
    n = 0
    while True:
        n += 1
        if n >= 3:
            break
    return out, n

print(loops())
