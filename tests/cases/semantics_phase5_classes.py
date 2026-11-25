class Point:
    count = 0

    def __init__(self, x, y=0):
        self.x = x
        self.y = y
        Point.count += 1

    def __repr__(self):
        return f"Point({self.x}, {self.y})"

    def __eq__(self, other):
        return isinstance(other, Point) and self.x == other.x and self.y == other.y

    def __lt__(self, other):
        return (self.x, self.y) < (other.x, other.y)

    def __add__(self, other):
        return Point(self.x + other.x, self.y + other.y)

    def norm1(self):
        return abs(self.x) + abs(self.y)

p = Point(1, 2)
q = Point(3)
r = p + q
print(p, q, r, Point.count, p == Point(1, 2), p != q, r.norm1())
print(max([p, q, r]), min([q, p]), p < q, q > p, str(p), repr(q))

class Animal:
    def __init__(self, name):
        self.name = name
        self.tricks = []

    def speak(self):
        return self.name + " makes a sound"

    def learn(self, trick):
        self.tricks.append(trick)
        return self

    def __str__(self):
        return f"{type(self).__name__}({self.name})"

class Dog(Animal):
    def __init__(self, name, breed):
        super().__init__(name)
        self.breed = breed

    def speak(self):
        return super().speak() + " (woof)"

class Puppy(Dog):
    def speak(self):
        return "small " + super().speak()

d = Dog("Rex", "lab").learn("sit").learn("roll")
pup = Puppy("Bit", "pug")
print(d.speak(), d.tricks, pup.speak(), str(pup), isinstance(pup, Animal), isinstance(d, Puppy))
print(issubclass(Puppy, Animal), type(d).__name__, Dog.__name__, hasattr(d, "breed"), getattr(d, "age", -1))

class Stack:
    def __init__(self):
        self.items = []
        self.pushes = 0

    def push(self, v):
        self.items.append(v)
        self.pushes += 1

    def pop(self):
        if not self.items:
            raise EmptyError("stack is empty")
        return self.items.pop()

    def __len__(self):
        return len(self.items)

class EmptyError(Exception):
    pass

s = Stack()
for v in [1, 2, 3]:
    s.push(v)
print(len(s), s.pop(), len(s), bool(s), s.pushes)
s.pop()
s.pop()
try:
    s.pop()
except EmptyError as e:
    print("error:", e, isinstance(e, Exception), type(e).__name__)

class Account:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self.balance = balance

    def withdraw(self, amount):
        if amount > self.balance:
            raise ValueError(f"{self.owner}: insufficient funds")
        self.balance -= amount

accounts = [Account("a", 50), Account("b", 10)]
for acc in accounts:
    try:
        acc.withdraw(20)
    except ValueError as err:
        print(err)
print([acc.balance for acc in accounts], sorted(accounts, key=lambda a: a.balance)[0].owner)
