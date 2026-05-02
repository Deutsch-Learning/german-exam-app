# 📘 German Learning App

A simple and interactive application designed to help users learn and practice the German language effectively. Whether you're a beginner or improving your skills, this app provides structured lessons, exercises, and real-life practice.

---

## 🚀 Features

* 📖 Structured lessons (A1 → advanced)
* 🧠 Vocabulary practice with quizzes
* 🗣️ Pronunciation training
* ✍️ Grammar exercises
* 🎯 Progress tracking
* 📱 Clean and user-friendly interface

---

## 🛠️ Tech Stack

* **Frontend:** React (inside `client/gem-app`)
* **Backend:** Node.js (inside `server`)
* **Database:** PostgreSQL

---

## 📦 Installation

### 1. Clone the repository

```bash
git clone https://github.com/Yong-Justice/german-exam-app.git
cd german-exam-app
```
---

### 2. Install dependencies

#### Frontend

```bash
cd client/gem-app
npm install
```

#### Backend

```bash
cd ../../server
npm install
```
---

## ⚙️ Environment Variables

Create a `.env` file in the appropriate directories.

### Example:

```bash
cp .env.example .env
```

Then configure:

```env
API_URL=your_api_url
DATABASE_URL=your_database_url
SECRET_KEY=your_secret_key
```

> ⚠️ Never commit your `.env` file

---

## ▶️ Running the Project

### 🚀 Start Full Application (Frontend + Backend)

From the root folder, run:

```bash
npm start
```

This will start:

* Backend server → `http://localhost:3000`
* Frontend app → `http://localhost:5173`

---

### 🔧 Run Separately (Optional)

If you prefer to run them individually:

#### Start Backend

```bash
cd server
npm run dev
```

#### Start Frontend

```bash
cd client/gem-app
npm run dev
```
---

## 📁 Project Structure

```
german-exam-app/
│
├── client/
│   ├── gem-app/       # React frontend
│   └── node_modules/
│
├── server/            # Node.js backend
├── .gitignore
├── README.md
└── LICENSE
```
---

## 🧪 Scripts

### Root (Run Full App)

```bash
npm start
```
Runs both frontend and backend together using a single command.

### Frontend (`client/gem-app`)

```bash
npm run dev      # Start dev server
npm run build    # Build app
npm start        # Run production build
```

### Backend (`server`)

```bash
npm run dev      # Start backend server
npm start        # Production start
```
---

## ❗ Important Notes

* `node_modules/` is excluded → run `npm install`
* `.env` is not included → create it manually
* Make sure backend is running before frontend (if API is required)
*Make sure dependencies are installed before running:
  npm install
*Ensure .env files are properly configured
*If a port is busy, the frontend may automatically switch (e.g. 5173 → 5174)

---

## 🧪 Usage

1. Start backend server
2. Start frontend app
3. Open the app in your browser
4. Choose your German level
5. Start learning and track progress

---

## 🤝 Contributing

Contributions are welcome!

Steps:

1. Fork the repository
2. Create a branch (`git checkout -b feature-name`)
3. Commit changes
4. Push and open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 📬 Contact

* GitHub: [https://github.com/Yong-Justice](https://github.com/Yong-Justice)
* GitHub: [https://github.com/miaShiota](https://github.com/miaShiota)
* Email: [yongjusticeanimbomnumfor@gmail.com](mailto:yongjusticeanimbomnumfor@gmail.com)
* Email: [stephanierossa53@gmail.com](mailto:stephanierossa53@gmail.com)

---
