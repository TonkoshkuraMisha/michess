import asyncio
import websockets
import json

# Вставьте сюда ваш токен для Player 3
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIzIiwiZXhwIjoxNzg1OTIxOTk1fQ.dlrTD_zVbRf_PZ4-9MPyFDg4Kde3e8EYKJB0By9ABCU"
URL = f"ws://127.0.0.1:8000/api/v1/ws/matchmaking?token={TOKEN}"


async def test_websocket():
    try:
        async with websockets.connect(URL) as ws:
            print("Connected to server!")

            welcome_msg = await ws.recv()
            print(f"Received: {welcome_msg}")

            # 1. Запрашиваем список всех вызовов в лобби
            print("Requesting seeks list...")
            await ws.send(json.dumps({"action": "get_seeks"}))

            game_id = None

            while True:
                msg = await ws.recv()
                print(f"Server says: {msg}")
                data = json.loads(msg)

                # 2. Получили список вызовов -> принимаем первый доступный
                if data.get("event") == "seeks_list":
                    seeks = data.get("seeks", [])
                    if seeks:
                        opponent = seeks[0]
                        print(f"Found seek from {opponent['username']}. Accepting...")
                        await ws.send(json.dumps({
                            "action": "accept_seek",
                            "opponent_id": opponent["user_id"],
                            "base_time_ms": opponent["base_time_ms"],
                            "increment_ms": opponent["increment_ms"]
                        }))
                    else:
                        print("No seeks found in lobby. Retrying in 2 seconds...")
                        await asyncio.sleep(2)
                        await ws.send(json.dumps({"action": "get_seeks"}))

                # 3. Сохраняем ID игры при старте
                elif data.get("event") == "match_found":
                    game_id = data["game_id"]

                # 4. Если белые походили -> отвечаем e7e5
                elif data.get("event") == "move_made":
                    # Проверяем, что ход сделал соперник, а не мы сами
                    if data.get("player_id") != 3:  # ID текущего пользователя (Player 3)
                        print("Opponent moved. Sending move e7e5...")
                        await asyncio.sleep(1)  # Имитация времени на раздумье
                        await ws.send(json.dumps({
                            "action": "make_move",
                            "game_id": game_id,
                            "move": "e7e5",
                            "time_taken_ms": 1000,
                            "window_blurred": False
                        }))

    except websockets.exceptions.ConnectionClosed:
        print("Connection closed.")
    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    asyncio.run(test_websocket())