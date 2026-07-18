# Feature: animação procedural de combate da caveira

## Escopo implementado

A caveira passou de uma oscilação simples aplicada em poucos ossos para uma animação procedural orientada por estados.

Estados e transições implementados:

- repouso e respiração leve;
- caminhada com alternância de pernas;
- movimentação de coxas, joelhos, pés e dedos;
- contrabalanço de quadril, coluna, ombros e cabeça;
- empunhadura da espada na mão direita;
- preparação do golpe;
- levantamento da espada;
- corte;
- janela sincronizada de impacto;
- recuperação e retorno à postura de perseguição.

O dano não é mais aplicado imediatamente ao entrar no alcance. Ele ocorre durante a janela visual do corte e a distância, as estruturas e os obstáculos são verificados novamente no instante do impacto.

## Arquivo principal

- `js/skeletons.js`

## Observações técnicas

1. O modelo `assets/models/skeleton.v1.glb` possui rig e uma animação chamada `Take 01`, mas a implementação atual utiliza poses procedurais para controlar diretamente a caminhada e o ataque.
2. A localização dos ossos aceita diferentes variações de nomenclatura, reduzindo dependência de nomes exatos exportados pelo Blender ou Sketchfab.
3. A espada é a cimitarra embutida no próprio GLB (malha `Circle_3`, 100% rígida no osso `Hand.R`): acompanha a mão de graça pelo skinning. Não existe mais malha procedural de espada. No frame local da mão a lâmina corre em `-Z` (perpendicular ao punho) e o cabo em `+Y`.
4. A caveira interrompe o deslocamento durante o ataque para evitar deslize artificial enquanto executa o golpe.
5. O alcance de início do ataque é maior que o alcance de dano, permitindo preparação, oportunidade de esquiva e leitura visual do movimento.
6. Os principais parâmetros de ajuste estão concentrados nas constantes de combate e nas curvas de preparação, corte e recuperação dentro de `js/skeletons.js`.

## Validação realizada

- leitura do rig e dos nomes de ossos disponíveis no GLB;
- revisão estática do fluxo de perseguição, colisão e ataque;
- verificação de sintaxe JavaScript;
- confirmação do arquivo alterado e dos commits na branch `refatoracao`.

## Mapeamento de eixos validado

A validação visual foi feita com `scripts/capture-skeletons.js` (PNGs + relatório numérico por frame) e com sondas de rotação por eixo em cada osso. O mapa resultante está comentado no topo de `js/skeletons.js`. Os pontos que derrubam qualquer intuição:

- o export é T-pose: os braços precisam de correção estática (~70° pra baixo) antes de qualquer offset de animação;
- os ossos `Foot.L/R` são filhos do `rootJoint`, não das panturrilhas — girar coxa/joelho não move as botas; a passada é translação local do osso do pé em contrafase com as coxas;
- nas coxas o balanço sagital é o eixo Z; nas panturrilhas a flexão do joelho é o eixo X (o Z é torção lateral);
- a lâmina termina o corte dentro de ±20° do eixo até o player (medido ≤17,6° na janela de dano).

## Checklist de avaliação manual

1. Confirmar que a caveira caminha sem deslizar excessivamente os pés.
2. Verificar se joelhos e pés dobram no sentido correto.
3. Confirmar que a espada permanece próxima da mão direita durante caminhada e ataque.
4. Observar se a caveira para de avançar enquanto corta.
5. Aproximar-se e recuar durante a preparação para confirmar que o golpe pode errar.
6. Colocar uma parede ou obstáculo entre jogador e caveira e verificar que o dano é bloqueado.
7. Confirmar que o dano acontece durante o corte, e não no começo da animação.
8. Avaliar se cabeça e mandíbula permanecem naturais durante caminhada e ataque.
9. Testar várias caveiras simultaneamente para observar custo de CPU e estabilidade.

## Possíveis ajustes após avaliação visual

- amplitude das coxas e panturrilhas;
- rotação local dos braços e antebraços;
- orientação do punho direito;
- direção de repouso e direção de corte da espada;
- duração total do ataque e posição da janela de impacto;
- velocidade da caminhada procedural;
- intensidade do movimento de tronco e cabeça.
