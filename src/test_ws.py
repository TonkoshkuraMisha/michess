import asyncio
import websockets
import json

# Вставьте сюда ваш токен, который вы получили при логине в Swagger
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIxIiwiZXhwIjoxNzg1ODc5MTA1fQ.Vt4T4MDQZdPP6MgguI8xizFQUWS7SX1QnQu7jrvyTYA"
URL = f"ws://127.0.0.1:8000/api/v1/ws/matchmaking?token={TOKEN}"


async def test_websocket():
    try:
        async with websockets.connect(URL) as ws:
            print("Connected to server!")

            # Ждем приветственное сообщение
            welcome_msg = await ws.recv()
            print(f"Received: {welcome_msg}")

            # Отправляем команду поиска игры
            print("Sending 'find_game' action...")
            await ws.send(json.dumps({"action": "find_game"}))

            # Бесконечно слушаем всё, что присылает сервер
            while True:
                msg = await ws.recv()
                print(f"Server says: {msg}")

    except websockets.exceptions.ConnectionClosed:
        print("Connection closed.")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())