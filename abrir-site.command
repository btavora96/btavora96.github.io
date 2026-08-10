#!/bin/bash
#
# Abre o site como um site, não como ficheiros soltos.
#
# Aberto por duplo-clique, o Chrome trata cada ficheiro desta pasta como
# vindo de um sítio diferente, e recusa-se a deixar uma página ler a
# seguinte. A transição entre categorias precisa exactamente disso — sem
# ela, cada mudança de categoria volta a ser um carregamento completo.
#
# Servir a pasta resolve-o: passa a ser tudo o mesmo sítio. É também a
# forma como o site vai correr quando estiver publicado.
#
# Para parar: fecha esta janela do Terminal (ou Ctrl-C).

cd "$(dirname "$0")" || exit 1

PORTA=8000
while lsof -i :$PORTA >/dev/null 2>&1; do
  PORTA=$((PORTA + 1))
done

echo ""
echo "  A servir o portfólio em http://localhost:$PORTA"
echo "  Deixa esta janela aberta enquanto estiveres a ver o site."
echo ""

python3 -m http.server "$PORTA" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVIDOR=$!

# Dá ao servidor um instante para ficar de pé antes de o browser bater à porta.
sleep 1
open "http://localhost:$PORTA/"

trap 'kill $SERVIDOR 2>/dev/null' EXIT
wait $SERVIDOR
