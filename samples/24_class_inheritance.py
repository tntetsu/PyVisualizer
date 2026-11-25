class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return self.name + " makes a sound."

class Dog(Animal):
    def __init__(self, name):
        super().__init__(name)
        self.tricks = []

    def learn(self, trick):
        self.tricks.append(trick)

    def speak(self):
        return self.name + " barks."

d = Dog("Rex")
d.learn("sit")
d.learn("roll")
print(d.speak(), d.tricks)
a = Animal("Generic")
print(a.speak())
